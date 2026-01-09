// @shared/format.js
function formatPrice(amount, currency = 'BRL') {
    if (currency === 'BRL') {
        return `R$ ${parseFloat(amount).toFixed(2).replace('.', ',')}`;
    } else if (currency === 'USD') {
        return `$${parseFloat(amount).toFixed(2)}`;
    }
    return `${amount} ${currency}`;
}

module.exports = { formatPrice };