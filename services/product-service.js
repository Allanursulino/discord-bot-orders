const db = require("../database");
const { v4: uuidv4 } = require('uuid');
const config = require('../config.json');

class ProductService {
    // Salvar produto com região
    saveProduct(productData) {
        const productId = productData.id || uuidv4();
        const region = productData.region || 'br'; // Default: Brasil
        
        const product = {
            id: productId,
            title: productData.title,
            description: productData.description || '',
            price: productData.price || 0,
            region: region,
            currency: config.regions[region]?.currency || 'BRL',
            stock: productData.stock || null,
            image: productData.image || '',
            footer: productData.footer || '',
            variants: productData.variants || [],
            delivery_type: productData.delivery_type || 'digital',
            delivery_content: productData.delivery_content || '',
            created_at: productData.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        db.set(`product:${productId}`, product);
        return product;
    }

    // Obter produto
    getProduct(productId) {
        return db.get(`product:${productId}`);
    }

    // Listar produtos por região
    getProductsByRegion(region) {
        const all = db.all();
        return all
            .filter(entry => entry.ID.startsWith('product:'))
            .map(entry => entry.data)
            .filter(product => !region || product.region === region);
    }

    // Listar todos os produtos
    getAllProducts() {
        const all = db.all();
        return all
            .filter(entry => entry.ID.startsWith('product:'))
            .map(entry => entry.data);
    }

    // Atualizar produto
    updateProduct(productId, updates) {
        const product = this.getProduct(productId);
        if (!product) return null;

        const updatedProduct = {
            ...product,
            ...updates,
            updated_at: new Date().toISOString()
        };

        db.set(`product:${productId}`, updatedProduct);
        return updatedProduct;
    }

    // Deletar produto
    deleteProduct(productId) {
        return db.delete(`product:${productId}`);
    }

    // Verificar estoque
    checkStock(productId, quantity = 1, variantId = null) {
        const product = this.getProduct(productId);
        if (!product) return false;

        if (product.variants && product.variants.length > 0) {
            if (!variantId) return false;
            const variant = product.variants.find(v => v.id === variantId);
            return variant && (variant.stock === null || variant.stock >= quantity);
        }

        return product.stock === null || product.stock >= quantity;
    }

    // Reduzir estoque
    reduceStock(productId, quantity = 1, variantId = null) {
        const product = this.getProduct(productId);
        if (!product) return false;

        if (product.variants && product.variants.length > 0) {
            if (!variantId) return false;
            const variantIndex = product.variants.findIndex(v => v.id === variantId);
            if (variantIndex === -1) return false;

            if (product.variants[variantIndex].stock !== null) {
                product.variants[variantIndex].stock -= quantity;
            }
        } else if (product.stock !== null) {
            product.stock -= quantity;
        }

        db.set(`product:${productId}`, product);
        return true;
    }

    // Obter informações da região do produto
    getProductRegionInfo(productId) {
        const product = this.getProduct(productId);
        if (!product) return config.regions.br; // Default
        
        return config.regions[product.region] || config.regions.br;
    }

    // NOVO: Pesquisar produtos por título
    searchProducts(searchTerm) {
        const allProducts = this.getAllProducts();
        const searchLower = searchTerm.toLowerCase();
        
        return allProducts.filter(product => 
            product.title.toLowerCase().includes(searchLower) ||
            product.description.toLowerCase().includes(searchLower) ||
            product.id.toLowerCase().includes(searchLower)
        );
    }

    // NOVO: Contar produtos por região
    getProductCountByRegion() {
        const allProducts = this.getAllProducts();
        const count = {};
        
        allProducts.forEach(product => {
            if (!count[product.region]) {
                count[product.region] = 0;
            }
            count[product.region]++;
        });
        
        return count;
    }

    // NOVO: Obter produtos recentes
    getRecentProducts(limit = 10) {
        const allProducts = this.getAllProducts();
        
        return allProducts
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, limit);
    }
}

module.exports = new ProductService();