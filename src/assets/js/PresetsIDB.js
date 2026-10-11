import {toRaw} from "vue";

export class Db {
    DB_NAME = "Playtronica_WebMIDI_db"
    STORE_NAME = "Biotron_Patches"
    VERSION = 7

    constructor(commands) {
        this.indexedDB = window.indexedDB || window.mozIndexedDB ||
            window.webkitIndexedDB || window.msIndexedDB || window.shimIndexedDB;
        this.commands = commands;
    }

    _openConnection() {
        return new Promise((resolve, reject) => {
            if (!this.indexedDB) {
                reject(new Error("IndexedDB is unavailable in this browser"));
                return;
            }
            let request;
            try {
                request = this.indexedDB.open(this.DB_NAME, this.VERSION);
            } catch (error) {
                reject(error);
                return;
            }
            let settled = false;
            let created = false;
            request.onupgradeneeded = () => {
                const db = request.result;
                // Existing stores contain user presets. Never replace one on upgrade.
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME, {keyPath: "id", autoIncrement: true});
                    created = true;
                }
            };
            request.onerror = () => {
                if (!settled) reject(request.error || new Error("Could not open preset storage"));
                settled = true;
            };
            request.onblocked = () => {
                if (!settled) reject(new Error("Preset storage upgrade is blocked by another tab"));
                settled = true;
            };
            request.onsuccess = () => {
                const db = request.result;
                if (settled) {
                    db.close();
                    return;
                }
                settled = true;
                db.onversionchange = () => db.close();
                resolve({db, created});
            };
        });
    }

    async openDB() {
        const {db, created} = await this._openConnection();
        db.close();
        return created;
    }

    async _transaction(mode, work) {
        const {db} = await this._openConnection();
        return new Promise((resolve, reject) => {
            let transaction;
            let result;
            let failure;
            let finished = false;
            const finish = (error) => {
                if (finished) return;
                finished = true;
                db.close();
                if (error) reject(error);
                else resolve(result);
            };
            try {
                transaction = db.transaction(this.STORE_NAME, mode);
                transaction.oncomplete = () => finish();
                transaction.onabort = () => finish(failure || transaction.error || new Error("Preset transaction aborted"));
                transaction.onerror = () => {
                    failure ||= transaction.error || new Error("Preset transaction failed");
                };
                const fail = error => {
                    failure = error;
                    transaction.abort();
                };
                work(transaction.objectStore(this.STORE_NAME), value => { result = value; }, fail);
            } catch (error) {
                if (transaction) {
                    try {
                        failure = error;
                        transaction.abort();
                    } catch (_) {
                        finish(error);
                    }
                } else {
                    finish(error);
                }
            }
        });
    }

    initialize(defaults) {
        return this._transaction("readwrite", (store) => {
            const count = store.count();
            count.onsuccess = () => {
                if (count.result !== 0) return;
                for (const {name, data} of defaults) {
                    store.add({name, editable: false, saved: true, data: toRaw(data)});
                }
            };
        });
    }

    createPatch(data, name) {
        return this._transaction("readwrite", (store, setResult) => {
            const request = store.add({
                name: name || "Unsaved Patch", editable: true, saved: Boolean(name), data: toRaw(data)
            });
            request.onsuccess = () => setResult(request.result);
        });
    }

    getPatch(id) {
        return this._transaction("readonly", (store, setResult) => {
            const request = id == null ? store.getAll() : store.get(this._key(id));
            request.onsuccess = () => setResult(request.result);
        });
    }

    async getUnsavedPatch() {
        const patches = await this.getPatch();
        const last = patches.at(-1);
        if (last && !last.saved) return last.id;
        return this.createPatch(last ? last.data : (this.DEFAULT || {}));
    }

    _key(id) {
        const key = Number(id);
        if (!Number.isSafeInteger(key) || key <= 0) throw new Error("Invalid preset key");
        return key;
    }

    _changePatch(id, change) {
        return this._transaction("readwrite", (store, setResult, fail) => {
            const key = this._key(id);
            const request = store.get(key);
            request.onsuccess = () => {
                try {
                    if (!request.result) {
                        fail(new Error(`Preset ${key} does not exist`));
                        return;
                    }
                    const patch = change(request.result);
                    const put = store.put(patch);
                    put.onsuccess = () => setResult(patch);
                } catch (error) { fail(error); }
            };
        });
    }

    updatePatch(id, data) {
        return this._changePatch(id, patch => ({...patch, data: toRaw(data)}));
    }

    savePatch(id, name) {
        if (!name || !name.trim()) return Promise.reject(new Error("Preset name is required"));
        return this._changePatch(id, patch => ({...patch, name: name.trim(), saved: true}));
    }

    deletePatch(id) {
        return this._transaction("readwrite", (store, setResult, fail) => {
            const key = this._key(id);
            const request = store.get(key);
            request.onsuccess = () => {
                try {
                    if (!request.result) {
                        fail(new Error(`Preset ${key} does not exist`));
                        return;
                    }
                    const deletion = store.delete(key);
                    deletion.onsuccess = () => setResult(key);
                } catch (error) { fail(error); }
            };
        });
    }
}

// Browser-preset feedback is emitted after a committed transaction or failure.
export async function withPresetFeedback(pageId, action, operation) {
    try {
        const result = await operation();
        document.dispatchEvent(new CustomEvent('PresetStorageResult', {
            detail: {pageId, action, ok: true}
        }));
        return result;
    } catch (error) {
        document.dispatchEvent(new CustomEvent('PresetStorageResult', {
            detail: {pageId, action, ok: false, message: error?.message || String(error)}
        }));
        return null;
    }
}
