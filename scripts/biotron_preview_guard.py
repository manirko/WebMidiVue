#!/usr/bin/env python3
"""Verify and, only after an exact confirmation, deploy a Biotron preview.

The deploy input is the prepared candidate archive, never the current checkout
or ``dist`` directory.  Verification is intentionally offline.  Cloudflare is
called only with ``--execute`` and the exact token printed by a successful
verification run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tomllib
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath


RELEASE_SCHEMA = "playtronica.biotron-beta-release-evidence.v1"
TEST_SCHEMA = "playtronica.biotron-beta-test-evidence.v1"
PROJECT_NAME = "biotron-settings-beta"
FORBIDDEN_BRANCHES = {"main", "master", "production", "prod", "deploy"}
REQUIRED_FILES = {
    "_headers",
    "_worker.js",
    "index.html",
    "manifest.json",
    "service-worker.js",
    "telemetry.html",
}
REQUIRED_HEADER_LINES = {
    "X-Frame-Options: DENY",
    "Content-Security-Policy: frame-ancestors 'none'",
    "Permissions-Policy: midi=(self), camera=(), microphone=(), geolocation=()",
    "Referrer-Policy: no-referrer",
    "X-Robots-Tag: noindex",
}


class CandidateError(ValueError):
    """The immutable candidate did not satisfy the preview contract."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CandidateError(f"cannot read JSON {path}: {error}") from error
    if not isinstance(value, dict):
        raise CandidateError(f"expected an object in {path}")
    return value


def safe_members(archive: tarfile.TarFile) -> list[tarfile.TarInfo]:
    members = archive.getmembers()
    if not members:
        raise CandidateError("candidate archive is empty")
    for member in members:
        path = PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts:
            raise CandidateError(f"unsafe archive path: {member.name}")
        if not path.parts or path.parts[0] != "dist":
            raise CandidateError(f"archive entry is outside dist/: {member.name}")
        if not (member.isfile() or member.isdir()):
            raise CandidateError(f"archive contains a non-file entry: {member.name}")
    return members


def extract_candidate(archive_path: Path, destination: Path) -> Path:
    with tarfile.open(archive_path, "r:gz") as archive:
        members = safe_members(archive)
        archive.extractall(destination, members=members, filter="data")
    dist = destination / "dist"
    if not dist.is_dir():
        raise CandidateError("candidate archive has no dist/ directory")
    return dist


def validate_branch(branch: str, build_id: str) -> None:
    if branch in FORBIDDEN_BRANCHES:
        raise CandidateError(f"refusing production-like branch: {branch}")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", branch):
        raise CandidateError("preview branch must contain only lowercase letters, digits and hyphens")
    if build_id not in branch:
        raise CandidateError("preview branch must contain the exact build ID")


def validate_manifest_files(dist: Path, release: dict, build_id: str) -> None:
    entries = release.get("files")
    if not isinstance(entries, list) or not entries:
        raise CandidateError("release evidence has no file manifest")
    if release.get("file_count") is not None and release.get("file_count") != len(entries):
        raise CandidateError("release evidence file_count does not match its manifest")

    expected: set[str] = set()
    build_marker_seen = False
    for item in entries:
        if not isinstance(item, dict):
            raise CandidateError("release file entry is not an object")
        relative = item.get("path")
        if not isinstance(relative, str):
            raise CandidateError("release file entry has no path")
        path = PurePosixPath(relative)
        if path.is_absolute() or ".." in path.parts or relative in expected:
            raise CandidateError(f"invalid or duplicate release path: {relative}")
        expected.add(relative)
        target = dist.joinpath(*path.parts)
        if not target.is_file():
            raise CandidateError(f"manifest file is missing: {relative}")
        if target.stat().st_size != item.get("bytes"):
            raise CandidateError(f"byte count mismatch: {relative}")
        if sha256_file(target) != item.get("sha256"):
            raise CandidateError(f"SHA-256 mismatch: {relative}")
        if build_id.encode("utf-8") in target.read_bytes():
            build_marker_seen = True

    actual = {
        path.relative_to(dist).as_posix()
        for path in dist.rglob("*")
        if path.is_file() and path.name != "release-evidence.json"
    }
    if actual != expected:
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        raise CandidateError(
            f"archive file set differs from manifest; missing={missing}, unexpected={unexpected}"
        )
    if not REQUIRED_FILES.issubset(actual):
        raise CandidateError(f"required beta files are missing: {sorted(REQUIRED_FILES - actual)}")
    if any("firmware" in PurePosixPath(path).parts or path.endswith(".uf2") for path in actual):
        raise CandidateError("general customer preview must not contain firmware artifacts")
    if "CNAME" in actual:
        raise CandidateError("preview must not contain the production CNAME")
    if not build_marker_seen:
        raise CandidateError("visible build ID is absent from deployable files")

    headers = {
        line.strip()
        for line in dist.joinpath("_headers").read_text(encoding="utf-8").splitlines()
        if line.strip()
    }
    if not REQUIRED_HEADER_LINES.issubset(headers):
        raise CandidateError(
            f"required preview headers are missing: {sorted(REQUIRED_HEADER_LINES - headers)}"
        )


def verify_candidate(
    candidate_dir: Path,
    build_id: str,
    expected_archive_sha256: str,
    branch: str,
    extract_root: Path,
) -> dict:
    candidate_dir = candidate_dir.resolve()
    archive_path = candidate_dir / f"biotron-beta-{build_id}.tar.gz"
    outer_release_path = candidate_dir / "release-evidence.json"
    test_path = candidate_dir / "test-evidence.json"
    if not archive_path.is_file():
        raise CandidateError(f"candidate archive not found: {archive_path}")
    if not re.fullmatch(r"[0-9a-f]{12}", build_id):
        raise CandidateError("build ID must be exactly 12 lowercase hexadecimal characters")
    if not re.fullmatch(r"[0-9a-f]{64}", expected_archive_sha256):
        raise CandidateError("expected archive SHA-256 must be 64 lowercase hexadecimal characters")
    validate_branch(branch, build_id)

    archive_sha256 = sha256_file(archive_path)
    if archive_sha256 != expected_archive_sha256:
        raise CandidateError(
            f"archive SHA-256 mismatch: expected {expected_archive_sha256}, got {archive_sha256}"
        )

    dist = extract_candidate(archive_path, extract_root)
    outer_release = load_json(outer_release_path)
    inner_release_path = dist / "release-evidence.json"
    inner_release = load_json(inner_release_path)
    if outer_release != inner_release:
        raise CandidateError("archive release evidence differs from candidate sidecar")

    commit = outer_release.get("commit")
    checks = {
        "schema": outer_release.get("schema") == RELEASE_SCHEMA,
        "product": outer_release.get("product") == "biotron",
        "build_id": outer_release.get("build_id") == build_id,
        "commit": isinstance(commit, str) and re.fullmatch(r"[0-9a-f]{40}", commit),
        "commit_prefix": isinstance(commit, str) and commit.startswith(build_id),
        "source_clean": outer_release.get("source_clean") is True,
        "firmware_disabled": outer_release.get("firmware_update_enabled") is False,
    }
    failed = [name for name, passed in checks.items() if not passed]
    if failed:
        raise CandidateError(f"release evidence failed: {', '.join(failed)}")
    validate_manifest_files(dist, outer_release, build_id)
    config_path = candidate_dir / "wrangler.toml"
    config_evidence = outer_release.get("deploy_config") or {}
    if (config_evidence.get("path") != "wrangler.toml" or not config_path.is_file() or
            config_path.stat().st_size != config_evidence.get("bytes") or
            sha256_file(config_path) != config_evidence.get("sha256")):
        raise CandidateError("candidate Wrangler config does not match release evidence")
    config = tomllib.loads(config_path.read_text(encoding="utf-8"))
    preview = config.get("env", {}).get("preview", {})
    if (set(config) != {"name", "compatibility_date", "pages_build_output_dir", "env"} or
            config["name"] != PROJECT_NAME or config["pages_build_output_dir"] != "./dist" or
            config["env"].get("production") != {} or
            preview.get("d1_databases") != [{"binding": "SESSION_EVENTS",
                "database_name": "playtronica-session-events",
                "database_id": "0d385f91-f646-4f8c-b508-344b4b2f8a6e"}]):
        raise CandidateError("candidate Wrangler config targets an unexpected project or database")
    shutil.copyfile(config_path, extract_root / "wrangler.toml")

    test = load_json(test_path)
    test_checks = {
        "schema": test.get("schema") == TEST_SCHEMA,
        "product": test.get("product") == "biotron",
        "commit": test.get("commit") == commit,
        "build_id": test.get("build_id") == build_id,
        "command": test.get("command") == "npm run test:biotron",
        "status": test.get("status") == "pass",
        "port_guard": "secondary_service_midi_port_hidden_from_device_picker"
        in (test.get("verified") or []),
        "telemetry_contract": "telemetry_contract_and_privacy"
        in (test.get("verified") or []),
    }
    failed_tests = [name for name, passed in test_checks.items() if not passed]
    if failed_tests:
        raise CandidateError(f"test evidence failed: {', '.join(failed_tests)}")

    token = f"DEPLOY:{PROJECT_NAME}:{branch}:{build_id}:{archive_sha256[:16]}"
    return {
        "status": "verified",
        "project": PROJECT_NAME,
        "branch": branch,
        "commit": commit,
        "build_id": build_id,
        "archive_sha256": archive_sha256,
        "file_count": len(outer_release["files"]),
        "served_file_count": sum(item["path"] not in {"_headers", "_worker.js"} for item in outer_release["files"]),
        "config_file_count": sum(item["path"] in {"_headers", "_worker.js"} for item in outer_release["files"]),
        "firmware_update_enabled": False,
        "dist": str(dist),
        "deploy_cwd": str(extract_root),
        "confirmation_token": token,
        "release": outer_release,
    }


def deployment_command(wrangler: Path, verified: dict) -> list[str]:
    return [
        str(wrangler),
        "pages",
        "deploy",
        verified["dist"],
        "--project-name",
        verified["project"],
        "--branch",
        verified["branch"],
        "--commit-hash",
        verified["commit"],
        "--commit-dirty=false",
    ]


def cloudflare_project_preflight(wrangler: Path) -> dict:
    """Prove the active Cloudflare session can see the exact beta project."""
    completed = subprocess.run(
        [str(wrangler), "pages", "project", "list", "--json"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if completed.returncode:
        raise CandidateError(
            "Cloudflare authentication preflight failed before upload; run wrangler login, then verify again"
        )
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise CandidateError("Cloudflare project preflight did not return JSON") from error
    projects = payload.get("result") if isinstance(payload, dict) else payload
    if not isinstance(projects, list):
        raise CandidateError("Cloudflare project preflight returned an unexpected shape")
    names = set()
    for item in projects:
        if not isinstance(item, dict):
            raise CandidateError("Cloudflare project preflight returned a malformed project")
        available = [item[key] for key in ("name", "Project Name") if key in item]
        if not available or any(not isinstance(name, str) or not name for name in available):
            raise CandidateError("Cloudflare project preflight returned a project without a name")
        if len(set(available)) != 1:
            raise CandidateError("Cloudflare project preflight returned conflicting project names")
        names.add(available[0])
    if PROJECT_NAME not in names:
        raise CandidateError(
            f"active Cloudflare account cannot see the required beta project: {PROJECT_NAME}"
        )
    return {"status": "verified", "project": PROJECT_NAME, "projects_seen": len(names)}


def unique_preview_url(output: str) -> str:
    urls = re.findall(r"https://[a-z0-9-]+\.biotron-settings-beta\.pages\.dev", output)
    for url in urls:
        label = urllib.parse.urlparse(url).hostname.split(".", 1)[0]
        if re.fullmatch(r"[0-9a-f]{8}", label):
            return url
    raise CandidateError("wrangler did not return an immutable deployment URL")


def request_bytes(url: str) -> tuple[bytes, object]:
    request = urllib.request.Request(url, headers={"User-Agent": "biotron-preview-guard/1"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read(), response.headers


def verify_remote(url: str, verified: dict) -> dict:
    release = verified["release"]
    last_error: Exception | None = None
    for _ in range(6):
        try:
            remote_release, root_headers = request_bytes(url + "/release-evidence.json")
            local_release = Path(verified["dist"], "release-evidence.json").read_bytes()
            if remote_release != local_release:
                raise CandidateError("remote release evidence is not byte-identical")
            for item in release["files"]:
                if item["path"] in {"_headers", "_worker.js"}:
                    continue  # Cloudflare applies these files; neither is served as a static asset.
                remote, asset_headers = request_bytes(url + "/" + urllib.parse.quote(item["path"]))
                if len(remote) != item["bytes"] or hashlib.sha256(remote).hexdigest() != item["sha256"]:
                    raise CandidateError(f"remote file mismatch: {item['path']}")
                if item["path"] == "garden/scene.html":
                    ancestors = [directive.strip() for directive in asset_headers.get("Content-Security-Policy", "").split(";")
                                 if directive.strip().startswith("frame-ancestors")]
                    if asset_headers.get("X-Frame-Options") != "SAMEORIGIN" or ancestors != ["frame-ancestors 'self'"]:
                        raise CandidateError("remote Garden is blocked from its same-origin iframe after redirects")
            health, _ = request_bytes(url + "/api/telemetry")
            if json.loads(health) != {"status": "ready"}:
                raise CandidateError("remote telemetry storage is not ready")
            header_expectations = {
                "X-Frame-Options": "DENY",
                "Content-Security-Policy": "frame-ancestors 'none'",
                "Permissions-Policy": "midi=(self), camera=(), microphone=(), geolocation=()",
                "Referrer-Policy": "no-referrer",
                "X-Robots-Tag": "noindex",
            }
            missing = {
                key: value
                for key, value in header_expectations.items()
                if root_headers.get(key) != value
            }
            if missing:
                raise CandidateError(f"remote security headers differ: {missing}")
            return {
                "status": "verified_remote",
                "immutable_url": url,
                "build_id": verified["build_id"],
                "commit": verified["commit"],
                "archive_sha256": verified["archive_sha256"],
                "file_count": verified["file_count"],
                "served_file_count": verified["served_file_count"],
                "config_file_count": verified["config_file_count"],
            }
        except Exception as error:  # network/propagation errors are retried as one unit
            last_error = error
            time.sleep(5)
    raise CandidateError(f"remote verification failed: {last_error}") from last_error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-dir", type=Path, required=True)
    parser.add_argument("--build-id", required=True)
    parser.add_argument("--archive-sha256", required=True)
    parser.add_argument("--branch")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm")
    parser.add_argument("--wrangler", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    branch = args.branch or f"candidate-{args.build_id}"
    with tempfile.TemporaryDirectory(prefix="biotron-preview-") as temporary:
        verified = verify_candidate(
            args.candidate_dir,
            args.build_id,
            args.archive_sha256,
            branch,
            Path(temporary),
        )
        plan = {key: value for key, value in verified.items() if key not in {"dist", "release", "deploy_cwd"}}
        if not args.execute:
            plan["next_action"] = "rerun with --execute, --wrangler and the exact confirmation token"
            print(json.dumps(plan, indent=2, sort_keys=True))
            return

        if args.confirm != verified["confirmation_token"]:
            raise CandidateError("exact deployment confirmation token is missing or incorrect")
        if args.wrangler is None:
            raise CandidateError("--wrangler is required for deployment; no downloader is invoked")
        wrangler = args.wrangler.resolve()
        if not wrangler.is_file() or not os.access(wrangler, os.X_OK):
            raise CandidateError(f"wrangler is not an executable file: {wrangler}")
        print(json.dumps({"cloudflare_preflight": cloudflare_project_preflight(wrangler)}, indent=2))
        command = deployment_command(wrangler, verified)
        completed = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=verified["deploy_cwd"],
        )
        print(completed.stdout, end="")
        if completed.returncode:
            raise CandidateError(f"Cloudflare upload failed with exit code {completed.returncode}; see diagnostic above")
        url = unique_preview_url(completed.stdout)
        print(json.dumps(verify_remote(url, verified), indent=2, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except CandidateError as error:
        raise SystemExit(f"candidate rejected: {error}") from error
