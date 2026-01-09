// @shared/index.js - VERSÃO CORRIGIDA
const db = require('../database');

// Função de formatação
function formatPrice(amount, currency = 'BRL') {
    const num = parseFloat(amount) || 0;
    if (currency === 'BRL') {
        return `R$ ${num.toFixed(2).replace('.', ',')}`;
    } else if (currency === 'USD') {
        return `$${num.toFixed(2)}`;
    }
    return `${num} ${currency}`;
}

// Exportar
module.exports = {
    db,
    formatPrice
};