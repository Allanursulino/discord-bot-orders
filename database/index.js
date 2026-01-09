// database/index.js - Banco de dados simples em JSON
const fs = require('fs');
const path = require('path');

class SimpleDatabase {
    constructor() {
        this.dataPath = path.join(__dirname, '../data');
        this.ensureDataDir();
        this.data = {};
        this.loadAll();
    }

    ensureDataDir() {
        if (!fs.existsSync(this.dataPath)) {
            fs.mkdirSync(this.dataPath, { recursive: true });
        }
    }

    getFilePath(key) {
        return path.join(this.dataPath, `${key.replace(/:/g, '_')}.json`);
    }

    set(key, value) {
        this.data[key] = value;
        const filePath = this.getFilePath(key);
        fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
        return true;
    }

    get(key) {
        if (this.data[key]) {
            return this.data[key];
        }
        
        const filePath = this.getFilePath(key);
        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                this.data[key] = JSON.parse(content);
                return this.data[key];
            } catch (error) {
                return null;
            }
        }
        return null;
    }

    delete(key) {
        const filePath = this.getFilePath(key);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        delete this.data[key];
        return true;
    }

    all() {
        const files = fs.readdirSync(this.dataPath);
        const allData = [];
        
        files.forEach(file => {
            if (file.endsWith('.json')) {
                const key = file.replace('.json', '').replace(/_/g, ':');
                const value = this.get(key);
                if (value) {
                    allData.push({ ID: key, data: value });
                }
            }
        });
        
        return allData;
    }

    loadAll() {
        const files = fs.readdirSync(this.dataPath);
        files.forEach(file => {
            if (file.endsWith('.json')) {
                const key = file.replace('.json', '').replace(/_/g, ':');
                this.get(key); // Carrega em memória
            }
        });
    }

    clear() {
        const files = fs.readdirSync(this.dataPath);
        files.forEach(file => {
            if (file.endsWith('.json')) {
                fs.unlinkSync(path.join(this.dataPath, file));
            }
        });
        this.data = {};
        return true;
    }
}

// Exportar uma instância única
module.exports = new SimpleDatabase();