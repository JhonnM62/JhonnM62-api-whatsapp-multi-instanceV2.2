/**
 * Script de prueba para verificar la funcionalidad de LID Mapping
 * después de las correcciones implementadas
 */

const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

async function testLIDMapping() {
    console.log('🧪 Iniciando prueba de LID Mapping...');
    
    try {
        // Configurar autenticación
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
        
        // Crear socket
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: { level: 'silent' }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                console.log('✅ Conexión establecida, probando LID Mapping...');
                
                // Probar acceso a LIDMappingStore
                try {
                    const lidMappingStore = sock.signalRepository?.getLIDMappingStore?.();
                    
                    if (!lidMappingStore) {
                        console.error('❌ No se pudo obtener LIDMappingStore');
                        return;
                    }
                    
                    console.log('✅ LIDMappingStore obtenido correctamente');
                    console.log('📋 Métodos disponibles:', Object.getOwnPropertyNames(Object.getPrototypeOf(lidMappingStore)));
                    
                    // Probar storeLIDPNMappings
                    if (typeof lidMappingStore.storeLIDPNMappings === 'function') {
                        console.log('✅ storeLIDPNMappings está disponible');
                        
                        // Probar con datos de ejemplo
                        const testMappings = [
                            { lid: '123456789@lid', pn: '1234567890' }
                        ];
                        
                        await lidMappingStore.storeLIDPNMappings(testMappings);
                        console.log('✅ storeLIDPNMappings ejecutado sin errores');
                        
                        // Probar getLIDForPN
                        if (typeof lidMappingStore.getLIDForPN === 'function') {
                            const lid = await lidMappingStore.getLIDForPN('1234567890');
                            console.log('✅ getLIDForPN resultado:', lid);
                        } else {
                            console.warn('⚠️ getLIDForPN no está disponible');
                        }
                        
                        // Probar getPNForLID
                        if (typeof lidMappingStore.getPNForLID === 'function') {
                            const pn = await lidMappingStore.getPNForLID('123456789@lid');
                            console.log('✅ getPNForLID resultado:', pn);
                        } else {
                            console.warn('⚠️ getPNForLID no está disponible');
                        }
                        
                    } else {
                        console.error('❌ storeLIDPNMappings no es una función');
                    }
                    
                } catch (error) {
                    console.error('❌ Error probando LID Mapping:', error);
                }
                
                // Cerrar conexión después de la prueba
                setTimeout(() => {
                    sock.end();
                    console.log('🔚 Prueba completada, cerrando conexión...');
                }, 5000);
            }
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('🔌 Conexión cerrada debido a:', lastDisconnect?.error, ', reconectando:', shouldReconnect);
                
                if (!shouldReconnect) {
                    process.exit(0);
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Error en prueba de LID Mapping:', error);
        process.exit(1);
    }
}

// Ejecutar prueba
testLIDMapping().catch(console.error);