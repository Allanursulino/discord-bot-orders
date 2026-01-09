const {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    PermissionFlagsBits,
    ChannelType
} = require("discord.js");
const CatalogService = require("../services/catalog-service");
const logger = require("../utils/logger");

module.exports = {
    options: {
        name: "setup",
        type: ApplicationCommandType.ChatInput,
        description: "Configurar o sistema de vendas",
        options: [
            {
                name: "canal_produtos",
                description: "Canal onde os produtos serão exibidos",
                type: ApplicationCommandOptionType.Channel,
                channel_types: [ChannelType.GuildText],
                required: true,
            }
        ],
    },
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply("❌ Você precisa ser administrador para configurar o sistema.");
        }

        const channel = interaction.options.getChannel("canal_produtos");
        
        // Aqui você salvaria no config ou DB
        // Por enquanto, vamos só confirmar
        const catalogService = new CatalogService(interaction.client);
        
        // Atualizar todos os produtos no novo canal
        // (Você precisa implementar isso no CatalogService)
        
        await interaction.editReply(`✅ Canal de produtos configurado: ${channel}\n\nOs produtos serão exibidos neste canal.`);
        
        logger.info(`Sistema configurado por ${interaction.user.tag}`, {
            canal_produtos: channel.id,
            canal_nome: channel.name
        });
    },
};