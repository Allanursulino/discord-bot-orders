const checkoutService = require('../services/checkout-service');
const CartService = require('../services/cart-service');
const logger = require('../utils/logger');
const config = require('../config.json');

module.exports = {
    execute: (client) => {
        const cartService = new CartService(client);
        
        // Usar intervalo padrão se não configurado
        const intervalSeconds = config.settings?.payment_check_interval_seconds || 30;
        
        setInterval(async () => {
            try {
                const allCheckouts = checkoutService.getAllCheckouts();
                const pendingCheckouts = allCheckouts.filter(checkout => 
                    checkout.status === 'PENDING'
                );

                for (const checkout of pendingCheckouts) {
                    try {
                        const updatedCheckout = await checkoutService.checkPaymentStatus(checkout.id);
                        
                        if (updatedCheckout && updatedCheckout.status === 'APPROVED') {
                            // Entregar produto
                            await cartService.deliverProduct(checkout.userId, checkout.id);
                            
                            // Fechar canal
                            await cartService.closeCheckoutChannel(checkout.id);
                            
                            logger.info(`Pagamento verificado e produto entregue: ${checkout.id}`);
                        }
                    } catch (error) {
                        logger.erro('VERIFICAR_PAGAMENTO_AUTO', error, checkout.userId);
                    }
                }
                
                // Limpar carrinhos abandonados a cada hora
                const now = new Date();
                if (now.getMinutes() === 0) { // A cada hora
                    const cleaned = await cartService.cleanupAbandonedCarts();
                    if (cleaned > 0) {
                        logger.info(`Carrinhos abandonados limpos: ${cleaned}`);
                    }
                }
            } catch (error) {
                logger.erro('PAYMENT_CHECKER_LOOP', error);
            }
        }, intervalSeconds * 1000);
    }
};