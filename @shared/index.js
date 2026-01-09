// @shared/index.js
const db = require('../database');
const { formatPrice } = require('./format');

module.exports = {
    db,
    formatPrice
};