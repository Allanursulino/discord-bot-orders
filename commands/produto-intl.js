const {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    PermissionFlagsBits,
    EmbedBuilder
} = require("discord.js");
const productService = require("../services/product-service");
const CatalogService = require("../services/catalog-service");
const config = require("../config.json");

module.exports = {
    options: {
        name: "produto-intl",
        type: ApplicationCommandType.ChatInput,
        description: "Criar rapidamente um produto internacional",
        options: [
            {
                name: "nome",
                description: "Nome do produto (em inglês)",
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: "preco",
                description: "Preço em USD (ex: 19.99)",
                type: ApplicationCommandOptionType.Number,
                required: true,
            },
            {
                name: "estoque",
                description: "Quantity in stock",
                type: ApplicationCommandOptionType.Integer,
                required: false,
            }
        ],
    },
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply("❌ Only administrators can create products.");
        }

        const nome = interaction.options.getString("nome");
        const preco = interaction.options.getNumber("preco");
        const estoque = interaction.options.getInteger("estoque");

        // Criar produto internacional
        const productData = {
            title: nome,
            price: preco,
            region: "intl",
            currency: "USD",
            stock: estoque || null,
            delivery_type: "digital"
        };

        const product = productService.saveProduct(productData);

        // Publicar no canal internacional
        const catalogService = new CatalogService(interaction.client);
        await catalogService.publishProduct(product.id);

        const embed = new EmbedBuilder()
            .setTitle("✅ INTERNATIONAL PRODUCT CREATED!")
            .setColor(0x0052A5)
            .setDescription(`Product created for international market`)
            .addFields(
                { name: "📦 Product", value: product.title, inline: true },
                { name: "💰 Price", value: `$${product.price.toFixed(2)} USD`, inline: true },
                { name: "📊 Stock", value: product.stock === null ? "∞ Unlimited" : `${product.stock} units`, inline: true },
                { name: "🌍 Region", value: "🌎 International", inline: true },
                { name: "📋 ID", value: `\`${product.id}\``, inline: false },
                { name: "💳 Payments", value: "💳 Credit/Debit Card Only", inline: false }
            )
            .setFooter({ text: "Product published in international channel" })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
};