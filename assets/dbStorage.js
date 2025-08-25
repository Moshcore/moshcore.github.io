/**
 * 基于IndexDB封装的仿localStage用法的工具
 * **/
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
class DBStorage {
  constructor(dbName, storeName) {
    const request = window.indexedDB.open(dbName);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    this.dbPromise = promisify(request);
    this.storeName = storeName;
  }
  async getStore(operationMode, storeName = this.storeName) {
    const db = await this.dbPromise;
    return db.transaction(storeName, operationMode).objectStore(storeName);
  }
  async setItem(key, value) {
    const store = await this.getStore('readwrite');
    return promisify(store.put(value, key));
  }
  async getItem(key) {
    const store = await this.getStore('readonly');
    return promisify(store.get(key));
  }
  async removeItem(key) {
    const store = await this.getStore('readwrite');
    return promisify(store.delete(key));
  }
  async clear() {
    const store = await this.getStore('readwrite');
    return promisify(store.clear());
  }
}
export default DBStorage;