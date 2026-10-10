from __future__ import annotations

import hashlib
import io
import json
import subprocess
import tarfile
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from contextlib import redirect_stdout

from scripts.biotron_preview_guard import CandidateError, cloudflare_project_preflight, main, verify_candidate, verify_remote


class BiotronPreviewGuardTests(unittest.TestCase):
    build_id = "0123456789ab"
    commit = build_id + "cdef0123456789abcdef01234567"

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.candidate = self.root / "candidate"
        self.dist = self.root / "source" / "dist"
        self.candidate.mkdir()
        self.dist.mkdir(parents=True)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    @staticmethod
    def sha(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def prepare(self, *, firmware_enabled: bool = False) -> tuple[Path, str]:
        files = {
            "index.html": f"<body>{self.build_id}</body>",
            "manifest.json": '{"name":"Biotron Settings Offline Beta"}',
            "service-worker.js": "self.addEventListener('fetch', () => {})",
            "telemetry.html": "<p>Technical events</p>",
            "garden/scene.html": "<canvas></canvas>",
            "_worker.js": "export default {fetch(request, env) { return env.ASSETS.fetch(request) }}",
            "_headers": "/*\n  X-Frame-Options: DENY\n  Content-Security-Policy: frame-ancestors 'none'\n  Permissions-Policy: midi=(self), camera=(), microphone=(), geolocation=()\n  Referrer-Policy: no-referrer\n  X-Robots-Tag: noindex\n",
        }
        for name, content in files.items():
            path = self.dist / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        manifest = [
            {"path": name, "bytes": (self.dist / name).stat().st_size, "sha256": self.sha(self.dist / name)}
            for name in sorted(files)
        ]
        config = """name = "biotron-settings-beta"
compatibility_date = "2026-08-26"
pages_build_output_dir = "./dist"
[env.production]
[[env.preview.d1_databases]]
binding = "SESSION_EVENTS"
database_name = "playtronica-session-events"
database_id = "0d385f91-f646-4f8c-b508-344b4b2f8a6e"
"""
        (self.candidate / "wrangler.toml").write_text(config, encoding="utf-8")
        release = {
            "deploy_config": {"path": "wrangler.toml", "bytes": len(config.encode()), "sha256": hashlib.sha256(config.encode()).hexdigest()},
            "schema": "playtronica.biotron-beta-release-evidence.v1",
            "product": "biotron",
            "commit": self.commit,
            "build_id": self.build_id,
            "source_clean": True,
            "firmware_update_enabled": firmware_enabled,
            "file_count": len(manifest),
            "files": manifest,
        }
        release_text = json.dumps(release, sort_keys=True)
        (self.dist / "release-evidence.json").write_text(release_text, encoding="utf-8")
        (self.candidate / "release-evidence.json").write_text(release_text, encoding="utf-8")
        (self.candidate / "test-evidence.json").write_text(json.dumps({
            "schema": "playtronica.biotron-beta-test-evidence.v1",
            "product": "biotron",
            "commit": self.commit,
            "build_id": self.build_id,
            "command": "npm run test:biotron",
            "status": "pass",
            "verified": ["secondary_service_midi_port_hidden_from_device_picker", "telemetry_contract_and_privacy"],
        }), encoding="utf-8")
        archive = self.candidate / f"biotron-beta-{self.build_id}.tar.gz"
        with tarfile.open(archive, "w:gz") as bundle:
            bundle.add(self.dist, arcname="dist")
        return archive, self.sha(archive)

    def verify(self, archive_sha256: str) -> dict:
        extract = self.root / "extract"
        extract.mkdir(exist_ok=True)
        return verify_candidate(
            self.candidate,
            self.build_id,
            archive_sha256,
            f"candidate-{self.build_id}",
            extract,
        )

    def test_accepts_exact_general_customer_candidate(self) -> None:
        _, digest = self.prepare()
        result = self.verify(digest)
        self.assertEqual(result["status"], "verified")
        self.assertFalse(result["firmware_update_enabled"])
        self.assertIn(self.build_id, result["confirmation_token"])

    def test_rejects_wrong_archive_hash(self) -> None:
        self.prepare()
        with self.assertRaisesRegex(CandidateError, "archive SHA-256 mismatch"):
            self.verify("0" * 64)

    def test_rejects_firmware_enabled_candidate(self) -> None:
        _, digest = self.prepare(firmware_enabled=True)
        with self.assertRaisesRegex(CandidateError, "firmware_disabled"):
            self.verify(digest)

    def test_rejects_production_branch(self) -> None:
        _, digest = self.prepare()
        extract = self.root / "extract-production"
        extract.mkdir()
        with self.assertRaisesRegex(CandidateError, "production-like branch"):
            verify_candidate(self.candidate, self.build_id, digest, "production", extract)

    @patch("scripts.biotron_preview_guard.subprocess.run")
    def test_cloudflare_preflight_requires_exact_beta_project(self, run) -> None:
        wrangler = self.root / "wrangler"
        run.return_value = SimpleNamespace(
            returncode=0,
            stdout=json.dumps([{"name": "biotron-settings-beta"}, {"name": "other"}]),
            stderr="",
        )
        result = cloudflare_project_preflight(wrangler)
        self.assertEqual(result, {
            "status": "verified", "project": "biotron-settings-beta", "projects_seen": 2,
        })
        run.assert_called_once_with(
            [str(wrangler), "pages", "project", "list", "--json"],
            stdout=-1, stderr=-1, text=True,
        )

    @patch("scripts.biotron_preview_guard.subprocess.run")
    def test_cloudflare_preflight_accepts_project_name_json(self, run) -> None:
        run.return_value = SimpleNamespace(returncode=0, stdout=json.dumps({
            "result": [{"Project Name": "biotron-settings-beta"}, {"Project Name": "other"}]
        }), stderr="")
        self.assertEqual(cloudflare_project_preflight(self.root / "wrangler")["projects_seen"], 2)

    def test_failed_upload_preserves_diagnostic_before_rejection(self) -> None:
        args = SimpleNamespace(candidate_dir=self.candidate, build_id=self.build_id,
                               archive_sha256="0" * 64, branch=None, execute=True,
                               confirm="exact-confirmation", wrangler=Path(__file__))
        verified = {"confirmation_token": args.confirm, "dist": str(self.dist),
                    "deploy_cwd": str(self.root), "release": {}, "project": "biotron-settings-beta",
                    "branch": "candidate-test", "commit": self.commit}
        output = io.StringIO()
        def failed_upload(command, **options):
            diagnostic = "ERROR: More than one account available\n"
            if options.get("check"):
                raise subprocess.CalledProcessError(1, command, output=diagnostic)
            return SimpleNamespace(returncode=1, stdout=diagnostic)
        with patch("scripts.biotron_preview_guard.parse_args", return_value=args), \
             patch("scripts.biotron_preview_guard.verify_candidate", return_value=verified), \
             patch("scripts.biotron_preview_guard.os.access", return_value=True), \
             patch("scripts.biotron_preview_guard.cloudflare_project_preflight", return_value={"status": "verified"}), \
             patch("scripts.biotron_preview_guard.subprocess.run", side_effect=failed_upload), \
             patch("scripts.biotron_preview_guard.verify_remote") as remote, redirect_stdout(output):
            with self.assertRaisesRegex(CandidateError, "upload failed.*1"):
                main()
        self.assertIn("ERROR: More than one account available", output.getvalue())
        remote.assert_not_called()

    @patch("scripts.biotron_preview_guard.subprocess.run")
    def test_cloudflare_preflight_rejects_malformed_json_and_conflicting_names(self, run) -> None:
        run.return_value = SimpleNamespace(returncode=0, stdout="not JSON", stderr="")
        with self.assertRaisesRegex(CandidateError, "did not return JSON"):
            cloudflare_project_preflight(self.root / "wrangler")
        run.return_value.stdout = json.dumps([{
            "name": "biotron-settings-beta", "Project Name": "production-site"
        }])
        with self.assertRaisesRegex(CandidateError, "conflicting project names"):
            cloudflare_project_preflight(self.root / "wrangler")
        run.return_value.stdout = json.dumps([{"unrelated": "biotron-settings-beta"}])
        with self.assertRaisesRegex(CandidateError, "without a name"):
            cloudflare_project_preflight(self.root / "wrangler")

    def remote_fixture(self):
        archive, digest = self.prepare()
        verified = self.verify(digest)
        origin = "https://abcdef12.biotron-settings-beta.pages.dev"
        served = {
            item["path"]: (self.dist / item["path"]).read_bytes()
            for item in verified["release"]["files"] if item["path"] not in {"_headers", "_worker.js"}
        }
        served["release-evidence.json"] = (self.dist / "release-evidence.json").read_bytes()
        served["api/telemetry"] = b'{"status":"ready"}'
        headers = {
            "X-Frame-Options": "DENY",
            "Content-Security-Policy": "frame-ancestors 'none'",
            "Permissions-Policy": "midi=(self), camera=(), microphone=(), geolocation=()",
            "Referrer-Policy": "no-referrer",
            "X-Robots-Tag": "noindex",
        }
        return archive, digest, verified, origin, served, headers

    @staticmethod
    def response_headers(name, headers):
        if name == "garden/scene.html":
            return {"X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "frame-ancestors 'self'"}
        return headers if name == "release-evidence.json" else {}

    def test_remote_rejects_blocked_garden_after_redirects(self) -> None:
        _, _, verified, origin, served, headers = self.remote_fixture()
        # request_bytes follows redirects: the final canonical response must allow this child.
        for frame_headers in [headers, {}, {"X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "frame-ancestors 'self'; frame-ancestors 'none'"}]:
            def fetch(url):
                name = urllib.parse.unquote(url.removeprefix(origin + "/"))
                return served[name], frame_headers if name == "garden/scene.html" else self.response_headers(name, headers)
            with patch("scripts.biotron_preview_guard.request_bytes", side_effect=fetch), patch("scripts.biotron_preview_guard.time.sleep"):
                with self.assertRaisesRegex(CandidateError, "Garden is blocked"):
                    verify_remote(origin, verified)

    def test_remote_verifies_every_served_asset_without_fetching_headers_config(self) -> None:
        archive, digest, verified, origin, served, headers = self.remote_fixture()
        requested = []
        def fetch(url):
            name = urllib.parse.unquote(url.removeprefix(origin + "/"))
            requested.append(name)
            if name not in served:
                raise AssertionError(f"unexpected remote fetch: {name}")
            return served[name], self.response_headers(name, headers)
        with patch("scripts.biotron_preview_guard.request_bytes", side_effect=fetch), patch(
            "scripts.biotron_preview_guard.time.sleep"
        ):
            result = verify_remote(origin, verified)
        self.assertEqual(result["served_file_count"], 5)
        self.assertEqual(result["config_file_count"], 2)
        self.assertEqual(set(requested), set(served))
        self.assertNotIn("_headers", requested)
        self.assertNotIn("_worker.js", requested)
        self.assertEqual(self.sha(archive), digest, "remote verification changed immutable archive")

    def test_remote_rejects_missing_applied_security_headers(self) -> None:
        _, _, verified, origin, served, headers = self.remote_fixture()
        headers.pop("X-Robots-Tag")
        def fetch(url):
            name = urllib.parse.unquote(url.removeprefix(origin + "/"))
            return served[name], self.response_headers(name, headers)
        with patch("scripts.biotron_preview_guard.request_bytes", side_effect=fetch), patch(
            "scripts.biotron_preview_guard.time.sleep"
        ):
            with self.assertRaisesRegex(CandidateError, "remote security headers differ"):
                verify_remote(origin, verified)

    def test_remote_rejects_corrupted_asset_and_spa_fallback_for_javascript(self) -> None:
        _, _, verified, origin, served, headers = self.remote_fixture()
        for name in ("index.html", "manifest.json", "service-worker.js"):
            with self.subTest(name=name):
                corrupted = dict(served)
                corrupted[name] = (served["index.html"] if name == "service-worker.js" else b"corrupt")
                def fetch(url):
                    path = urllib.parse.unquote(url.removeprefix(origin + "/"))
                    return corrupted[path], self.response_headers(path, headers)
                with patch("scripts.biotron_preview_guard.request_bytes", side_effect=fetch), patch(
                    "scripts.biotron_preview_guard.time.sleep"
                ):
                    with self.assertRaisesRegex(CandidateError, f"remote file mismatch: {name}"):
                        verify_remote(origin, verified)

    @patch("scripts.biotron_preview_guard.subprocess.run")
    def test_cloudflare_preflight_rejects_expired_auth_before_upload(self, run) -> None:
        run.return_value = SimpleNamespace(returncode=1, stdout="", stderr="expired")
        with self.assertRaisesRegex(CandidateError, "authentication preflight failed before upload"):
            cloudflare_project_preflight(self.root / "wrangler")

    @patch("scripts.biotron_preview_guard.subprocess.run")
    def test_cloudflare_preflight_rejects_wrong_account(self, run) -> None:
        run.return_value = SimpleNamespace(
            returncode=0, stdout=json.dumps([{"name": "production-site"}]), stderr="",
        )
        with self.assertRaisesRegex(CandidateError, "cannot see the required beta project"):
            cloudflare_project_preflight(self.root / "wrangler")


if __name__ == "__main__":
    unittest.main()
