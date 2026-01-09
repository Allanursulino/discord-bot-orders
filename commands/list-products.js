const {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");
const productService = require("../services/product-service");
const { formatPrice } = require("../@shared");
const logger = require("../utils/logger");
const config = require("../config.json");

module.exports = {
    options: {
        name: "listar-produtos",
        type: ApplicationCommandType.ChatInput,
        description: "Listar e gerenciar todos os produtos",
        options: [
            {
                name: "regiao",
                description: "Filtrar por região",
                type: ApplicationCommandOptionType.String,
                required: false,
                choices: [
                    { name: "🇧🇷 Brasil", value: "br" },
                    { name: "🌍 Internacional", value: "intl" },
                    { name: "🇺🇸 EUA", value: "us" },
                    { name: "🇪🇺 Europa", value: "eu" },
                    { name: "🌎 Todas", value: "all" }
                ]
            }
        ],
    },
    
    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const region = interaction.options.getString("regiao") || "all";
            
            // Verificar se é admin para ações de gerenciamento
            const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
            
            let products = productService.getAllProducts();
            
            // Filtrar por região se especificado
            if (region !== "all") {
                products = products.filter(product => product.region === region);
            }
            
            if (products.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle("📭 NENHUM PRODUTO ENCONTRADO")
                    .setColor(0xFFA500)
                    .setDescription(
                        region === "all" 
                            ? "Não há produtos cadastrados no sistema."
                            : `Não há produtos cadastrados para a região **${this.getRegionName(region)}**.`
                    )
                    .setFooter({ text: "Use /produto-br ou /produto-intl para criar novos produtos" })
                    .setTimestamp();
                
                return interaction.editReply({ embeds: [embed] });
            }
            
            // Criar embed com lista de produtos
            const embed = new EmbedBuilder()
                .setTitle("🛍️ LISTA DE PRODUTOS")
                .setColor(0x5865F2)
                .setDescription(
                    `**Total:** ${products.length} produto(s)` +
                    (region !== "all" ? `\n**Região:** ${this.getRegionName(region)}` : "")
                )
                .setFooter({ 
                    text: isAdmin 
                        ? "Clique nos botões abaixo para gerenciar produtos" 
                        : "Lista de produtos disponíveis"
                })
                .setTimestamp();
            
            // Agrupar produtos por região
            const productsByRegion = {};
            products.forEach(product => {
                if (!productsByRegion[product.region]) {
                    productsByRegion[product.region] = [];
                }
                productsByRegion[product.region].push(product);
            });
            
            // Adicionar campos por região
            Object.keys(productsByRegion).forEach(regionKey => {
                const regionProducts = productsByRegion[regionKey];
                const regionName = this.getRegionName(regionKey);
                const regionEmoji = this.getRegionEmoji(regionKey);
                
                let regionText = "";
                regionProducts.slice(0, 5).forEach((product, index) => {
                    regionText += `**${index + 1}. ${product.title}**\n`;
                    regionText += `• **ID:** \`${product.id}\`\n`;
                    regionText += `• **Preço:** ${formatPrice(product.price)}\n`;
                    regionText += `• **Estoque:** ${product.stock === null ? "∞ Ilimitado" : product.stock}\n`;
                    regionText += `• **Criado:** ${new Date(product.created_at).toLocaleDateString('pt-BR')}\n\n`;
                });
                
                if (regionProducts.length > 5) {
                    regionText += `... e mais ${regionProducts.length - 5} produtos`;
                }
                
                embed.addFields({
                    name: `${regionEmoji} ${regionName} (${regionProducts.length})`,
                    value: regionText || "*Nenhum produto*",
                    inline: false
                });
            });
            
            // Componentes (botões) - diferentes para admin e usuário comum
            const components = [];
            
            if (isAdmin) {
                // Linha 1: Ações principais de admin
                const row1 = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('admin_select_product')
                            .setLabel('🗑️ Apagar Produto')
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId('admin_edit_product')
                            .setLabel('✏️ Editar Produto')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('admin_create_product')
                            .setLabel('➕ Criar Produto')
                            .setStyle(ButtonStyle.Success)
                    );
                
                components.push(row1);
                
                // Linha 2: Ações em massa e filtros
                const row2 = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('admin_list_all_products')
                            .setLabel('🌎 Ver Todos')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('admin_list_br_products')
                            .setLabel('🇧🇷 Apenas BR')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('admin_list_intl_products')
                            .setLabel('🌍 Apenas INT')
                            .setStyle(ButtonStyle.Secondary)
                    );
                
                components.push(row2);
                
            } else {
                // Para usuários não-admin
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('user_view_details')
                            .setLabel('ℹ️ Ver Detalhes')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('user_filter_region')
                            .setLabel('🌍 Filtrar Região')
                            .setStyle(ButtonStyle.Secondary)
                    );
                
                components.push(row);
            }
            
            await interaction.editReply({
                embeds: [embed],
                components: components
            });
            
        } catch (error) {
            logger.erro('LISTAR_PRODUTOS', error, interaction.user.id);
            await interaction.editReply({
                content: `❌ Erro ao listar produtos: ${error.message}`,
                ephemeral: true
            });
        }
    },
    
    // Helper para nome da região
    getRegionName(region) {
        const regionNames = {
            'br': '🇧🇷 Brasil',
            'intl': '🌍 Internacional',
            'us': '🇺🇸 Estados Unidos',
            'eu': '🇪🇺 Europa'
        };
        return regionNames[region] || 'Desconhecida';
    },
    
    // Helper para emoji da região
    getRegionEmoji(region) {
        const regionEmojis = {
            'br': '🇧🇷',
            'intl': '🌍',
            'us': '🇺🇸',
            'eu': '🇪🇺'
        };
        return regionEmojis[region] || '📦';
    }
};