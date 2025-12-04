/**
 * IndexedDB 导出导入工具类（完整修复版）
 */
class IndexedDBManager {
    constructor(dbName, version = 1) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
    }

    /**
     * 打开数据库
     */
    async openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                this.db = event.target.result;
            };
        });
    }

    /**
     * 导出整个数据库
     */
    async exportDatabase() {
        try {
            if (!this.db) await this.openDB();

            const exportData = {
                dbName: this.dbName,
                version: this.version,
                exportDate: new Date().toISOString(),
                stores: {}
            };

            const storeNames = Array.from(this.db.objectStoreNames);

            for (const storeName of storeNames) {
                const data = await this.exportStore(storeName);
                exportData.stores[storeName] = data;
            }

            return exportData;
        } catch (error) {
            console.error('导出数据库失败:', error);
            throw error;
        }
    }

    /**
     * 导出单个对象存储（使用游标，同时保存 key 和 value）
     */
    async exportStore(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const data = [];

            const cursorRequest = store.openCursor();

            cursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                
                if (cursor) {
                    data.push({
                        key: cursor.key,
                        value: cursor.value
                    });
                    cursor.continue();
                } else {
                    const storeInfo = {
                        keyPath: store.keyPath,
                        autoIncrement: store.autoIncrement,
                        indexes: this.getIndexesInfo(store),
                        data: data,
                        recordCount: data.length
                    };
                    resolve(storeInfo);
                }
            };

            cursorRequest.onerror = () => reject(cursorRequest.error);
        });
    }

    /**
     * 获取索引信息
     */
    getIndexesInfo(store) {
        const indexes = [];
        for (let i = 0; i < store.indexNames.length; i++) {
            const indexName = store.indexNames[i];
            const index = store.index(indexName);
            indexes.push({
                name: index.name,
                keyPath: index.keyPath,
                unique: index.unique,
                multiEntry: index.multiEntry
            });
        }
        return indexes;
    }

    /**
     * 导入整个数据库
     */
    async importDatabase(importData, options = {}) {
        const { clearExisting = true, merge = false } = options;

        try {
            if (this.db) {
                this.db.close();
                this.db = null;
            }

            if (clearExisting && !merge) {
                await this.deleteDatabase();
            }

            await this.createDatabaseFromImport(importData);

            for (const [storeName, storeInfo] of Object.entries(importData.stores)) {
                await this.importStore(storeName, storeInfo, merge);
            }

            return { success: true, message: '数据导入成功' };
        } catch (error) {
            console.error('导入数据库失败:', error);
            throw error;
        }
    }

    /**
     * 根据导入数据创建数据库结构
     */
    async createDatabaseFromImport(importData) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);
            
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                for (const [storeName, storeInfo] of Object.entries(importData.stores)) {
                    if (!db.objectStoreNames.contains(storeName)) {
                        const store = db.createObjectStore(storeName, {
                            keyPath: storeInfo.keyPath,
                            autoIncrement: storeInfo.autoIncrement
                        });

                        storeInfo.indexes.forEach(indexInfo => {
                            store.createIndex(indexInfo.name, indexInfo.keyPath, {
                                unique: indexInfo.unique,
                                multiEntry: indexInfo.multiEntry
                            });
                        });
                    }
                }
            };
        });
    }

    /**
     * 导入单个对象存储的数据（正确处理 key）
     */
    async importStore(storeName, storeInfo, merge = false) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            if (!merge) {
                store.clear();
            }

            // 根据是否有 keyPath 决定导入方式
            storeInfo.data.forEach(item => {
                if (storeInfo.keyPath) {
                    // 如果有 keyPath，直接 put value
                    store.put(item.value);
                } else {
                    // 如果没有 keyPath（out-of-line keys），需要指定 key
                    store.put(item.value, item.key);
                }
            });

            transaction.oncomplete = () => {
                console.log(`✓ 已导入 ${storeInfo.data.length} 条记录到 ${storeName}`);
                resolve();
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * 删除数据库
     */
    async deleteDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(this.dbName);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
            request.onblocked = () => {
                console.warn('删除数据库被阻止，可能有其他连接未关闭');
            };
        });
    }

    /**
     * 导出为 JSON 文件
     */
    async exportToFile(filename) {
        try {
            const data = await this.exportDatabase();
            const jsonStr = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename || `${this.dbName}_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);

            console.log('✓ 导出成功:', filename);
            return { success: true, message: '导出成功' };
        } catch (error) {
            console.error('导出文件失败:', error);
            throw error;
        }
    }

    /**
     * 从文件导入
     */
    async importFromFile(file, options = {}) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const importData = JSON.parse(e.target.result);
                    
                    // 验证数据格式
                    if (!importData.stores) {
                        throw new Error('无效的导入文件格式');
                    }

                    const result = await this.importDatabase(importData, options);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    /**
     * 获取数据库统计信息
     */
    async getStats() {
        if (!this.db) await this.openDB();

        const stats = {
            dbName: this.dbName,
            version: this.version,
            stores: []
        };

        const storeNames = Array.from(this.db.objectStoreNames);

        for (const storeName of storeNames) {
            const storeData = await this.exportStore(storeName);
            stats.stores.push({
                name: storeName,
                count: storeData.recordCount,
                keyPath: storeData.keyPath,
                autoIncrement: storeData.autoIncrement,
                indexes: storeData.indexes.length
            });
        }

        return stats;
    }

    /**
     * 关闭数据库连接
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}