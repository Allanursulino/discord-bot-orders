const {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");
const productService = require("../services/product-service");
const config = require("../config.json");

module.exports = {
    options: {
        name: "regioes",
        type: ApplicationCommandType.ChatInput,
        description: "Gerenciar regiões e produtos",
        options: [
            {
                name: "acao",
                description: "Ação a ser realizada",
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: "📋 Listar produtos por região", value: "list" },
                    { name: "🌍 Ver configurações das regiões", value: "config" },
                    { name: "🔄 Re-publicar produtos", value: "republish" }
                ]
            },
            {
                name: "regiao",
                description: "Filtrar por região",
                type: ApplicationCommandOptionType.String,
                required: false,
                choices: [
                    { name: "🇧🇷 Brasil", value: "br" },
                    { name: "🌎 Internacional", value: "intl" },
                    { name: "🇺🇸 EUA", value: "us" },
                    { name: "🇪🇺 Europa", value: "eu" },
                    { name: "📦 Todas", value: "all" }
                ]
            }
        ],
    },
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply("❌ Você precisa ser administrador para gerenciar regiões.");
        }

        const action = interaction.options.getString("acao");
        const regionFilter = interaction.options.getString("regiao") || "all";

        try {
            if (action === "list") {
                await this.listProductsByRegion(interaction, regionFilter);
            } else if (action === "config") {
                await this.showRegionConfig(interaction);
            } else if (action === "republish") {
                await this.republishProducts(interaction, regionFilter);
            }
        } catch (error) {
            console.error("Erro no comando regiões:", error);
            await interaction.editReply("❌ Ocorreu um erro ao processar o comando.");
        }
    },

    // Listar produtos por região
    async listProductsByRegion(interaction, regionFilter) {
        const allProducts = productService.getAllProducts();
        
        // Filtrar por região
        const filteredProducts = regionFilter === "all" 
            ? allProducts 
            : allProducts.filter(p => p.region === regionFilter);

        if (filteredProducts.length === 0) {
            return interaction.editReply(`📭 Nenhum produto encontrado para a região selecionada.`);
        }

        // Agrupar por região
        const productsByRegion = {};
        filteredProducts.forEach(product => {
            if (!productsByRegion[product.region]) {
                productsByRegion[product.region] = [];
            }
            productsByRegion[product.region].push(product);
        });

        const regionInfo = config.regions;
        
        const embed = new EmbedBuilder()
            .setTitle("📦 Produtos por Região")
            .setColor(0x5865F2)
            .setDescription(`**Total:** ${filteredProducts.length} produto(s)`)
            .setFooter({ text: "Use /criar-produto para adicionar mais produtos" })
            .setTimestamp();

        for (const [regionCode, products] of Object.entries(productsByRegion)) {
            const info = regionInfo[regionCode] || { name: "Desconhecida" };
            const regionEmoji = info.emojis?.flag || "🌍";
            
            let fieldValue = "";
            products.forEach((product, index) => {
                const price = `${info.emojis?.currency || ''} ${product.price.toFixed(2)} ${product.currency}`;
                const stock = product.stock === null ? "∞" : product.stock;
                fieldValue += `${index + 1}. **${product.title}**\n   • ID: \`${product.id}\`\n   • Preço: ${price}\n   • Estoque: ${stock}\n\n`;
            });

            embed.addFields({
                name: `${regionEmoji} ${info.name} (${products.length})`,
                value: fieldValue || "*Nenhum produto*",
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });
    },

    // Mostrar configurações das regiões
    async showRegionConfig(interaction) {
        const regionInfo = config.regions;
        
        const embed = new EmbedBuilder()
            .setTitle("⚙️ Configurações das Regiões")
            .setColor(0x5865F2)
            .setDescription("Configuração atual do sistema multi-região")
            .setFooter({ text: "Configure em config.json" })
            .setTimestamp();

        for (const [regionCode, info] of Object.entries(regionInfo)) {
            const methods = info.payment_methods || [];
            const methodsText = methods.map(m => {
                if (m === "pix") return "💰 PIX";
                if (m === "card") return "💳 Cartão";
                if (m === "boleto") return "📄 Boleto";
                return m;
            }).join(", ");

            embed.addFields({
                name: `${info.emojis?.flag || "🌍"} ${info.name}`,
                value: `**Moeda:** ${info.currency}\n**Métodos:** ${methodsText}\n**Categoria:** ${info.category_id ? "✅ Configurada" : "❌ Não configurada"}\n**Canal:** ${info.product_channel ? `<#${info.product_channel}>` : "❌ Não configurado"}`,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });
    },

    // Re-publicar produtos
    async republishProducts(interaction, regionFilter) {
        const CatalogService = require("../services/catalog-service");
        const catalogService = new CatalogService(interaction.client);
        
        await interaction.editReply("🔄 Re-publicando produtos...");

        const allProducts = productService.getAllProducts();
        const productsToRepublish = regionFilter === "all" 
            ? allProducts 
            : allProducts.filter(p => p.region === regionFilter);

        let successCount = 0;
        let errorCount = 0;

        for (const product of productsToRepublish) {
            try {
                await catalogService.publishProduct(product.id);
                successCount++;
            } catch (error) {
                errorCount++;
                console.error(`Erro ao re-publicar ${product.id}:`, error);
            }
        }

        const regionName = regionFilter === "all" ? "todas as regiões" : config.regions[regionFilter]?.name || regionFilter;
        
        await interaction.editReply({
            content: `✅ **Re-publicação concluída!**\n\n📊 **Resultados:**\n• ✅ Sucesso: ${successCount} produto(s)\n• ❌ Erros: ${errorCount}\n• 🌍 Região: ${regionName}`
        });
    }
};