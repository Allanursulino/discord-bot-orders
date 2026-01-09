const db = require("../database");
const config = require("../config.json");

module.exports = {
    db,
    config,
    formatPrice: (value) => {
        return value.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
        });
    },
    formatValue: (type, value) => {
        if (type === "FIXED") return this.formatPrice(value);
        return `${value}%`;
    }
};