const checkoutService = require('../services/checkout-service');
const CartService = require('../services/cart-service');
const logger = require('../utils/logger');
const config = require('../config.json');

module.exports = {
    execute: (client) => {
        const cartService = new CartService(client);
        
        // Usar intervalo padrão se não configurado
        const intervalSeconds = config.settings?.payment_check_interval_seconds || 15;
        
        setInterval(async () => {
            try {
                // Buscar checkouts pendentes
                const pendingCheckouts = checkoutService.getPendingPayments();
                
                if (pendingCheckouts.length > 0) {
                    logger.info(`Verificando ${pendingCheckouts.length} pagamentos pendentes automaticamente...`);
                }

                for (const checkout of pendingCheckouts) {
                    try {
                        // Verificar se não excedeu tentativas
                        if (checkout.payment_attempts >= checkout.max_payment_attempts) {
                            logger.info(`Checkout ${checkout.id} excedeu tentativas, marcando como falha`);
                            checkout.status = 'FAILED';
                            checkout.updatedAt = new Date().toISOString();
                            checkoutService.updateCheckoutStatus(checkout.id, checkout);
                            continue;
                        }

                        const updatedCheckout = await checkoutService.checkPaymentStatus(checkout.id);
                        
                        if (updatedCheckout && updatedCheckout.status === 'APPROVED') {
                            logger.info(`Pagamento aprovado automaticamente: ${checkout.id}`);
                            
                            // Entregar produto
                            await cartService.deliverProduct(checkout.userId, checkout.id);
                            
                            // Fechar canal se configurado
                            if (config.settings.auto_delete_checkout) {
                                await cartService.closeCheckoutChannel(checkout.id);
                            }
                            
                            // Log detalhado
                            logger.pagamento(checkout.id, 'APROVADO_AUTO', checkout.payment?.provider || 'desconhecido', {
                                user_id: checkout.userId,
                                amount: checkout.total
                            });
                        } else if (updatedCheckout && updatedCheckout.status === 'EXPIRED') {
                            logger.info(`Checkout expirado: ${checkout.id}`);
                        }
                    } catch (error) {
                        logger.erro('VERIFICAR_PAGAMENTO_AUTO_CHECKOUT', error, checkout.id);
                    }
                }
                
                // Limpar carrinhos abandonados a cada hora (se configurado)
                const now = new Date();
                if (config.settings.cleanup_interval_minutes && now.getMinutes() === 0) {
                    try {
                        const cleaned = await cartService.cleanupAbandonedCarts();
                        if (cleaned > 0) {
                            logger.info(`Carrinhos abandonados limpos: ${cleaned}`);
                        }
                    } catch (error) {
                        logger.erro('LIMPEZA_CARRINHOS', error);
                    }
                }

            } catch (error) {
                logger.erro('AUTO_PAYMENT_CHECKER_LOOP', error);
            }
        }, intervalSeconds * 1000);

        // Log inicial
        client.once('ready', () => {
            logger.info(`Auto Payment Checker iniciado com intervalo de ${intervalSeconds} segundos`);
        });
    }
};