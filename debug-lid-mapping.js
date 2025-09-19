/**
 * Script de debug para probar el LID mapping de Baileys v7
 * Este script ayuda a diagnosticar problemas con la conversión LID/PN
 */

import { getSession, getListSessions } from './whatsapp.js';

async function debugLidMapping() {
    console.log('🔍 Iniciando debug del LID mapping...\n');
    
    // Listar sesiones disponibles
    const availableSessions = getListSessions();
    console.log('📱 Sesiones disponibles:', availableSessions);
    
    if (availableSessions.length === 0) {
        console.error('❌ No hay sesiones disponibles');
        console.log('💡 Asegúrate de que WhatsApp esté conectado y haya al menos una sesión activa');
        return;
    }
    
    // Usar la primera sesión disponible
    const sessionId = availableSessions[0];
    console.log(`🎯 Usando sesión: ${sessionId}`);
    
    const session = getSession(sessionId);
    
    if (!session) {
        console.error('❌ No se pudo obtener la sesión:', sessionId);
        return;
    }
    
    console.log('✅ Sesión obtenida correctamente');
    console.log('📱 Estado de conexión:', session.ws?.readyState || 'desconocido');
    
    // Verificar estructura de signalRepository
    console.log('\n🔧 Verificando signalRepository...');
    if (!session.signalRepository) {
        console.error('❌ signalRepository no está disponible');
        console.log('📋 Propiedades de la sesión:', Object.keys(session));
        return;
    }
    
    console.log('✅ signalRepository disponible');
    
    // Verificar lidMapping
    console.log('\n🗺️ Verificando lidMapping...');
    if (!session.signalRepository.lidMapping) {
        console.error('❌ lidMapping no está disponible');
        console.log('📋 Propiedades de signalRepository:', Object.keys(session.signalRepository));
        return;
    }
    
    console.log('✅ lidMapping disponible');
    
    // Verificar métodos disponibles
    const lidMapping = session.signalRepository.lidMapping;
    console.log('\n📋 Métodos disponibles en lidMapping:');
    console.log('- getLIDForPN:', typeof lidMapping.getLIDForPN);
    console.log('- getPNForLID:', typeof lidMapping.getPNForLID);
    console.log('- Todos los métodos:', Object.getOwnPropertyNames(lidMapping));
    
    // Probar conversiones con números reales
    console.log('\n🧪 Probando conversiones...');
    
    // Números de prueba basados en los archivos de sesión que vimos
    const testNumbers = [
        '573027505366',
        '573148376611', 
        '573152727771',
        '573181359070'
    ];
    
    for (const phoneNumber of testNumbers) {
        console.log(`\n📞 Probando con número: ${phoneNumber}`);
        
        try {
            // Probar getLIDForPN
            const lid = await lidMapping.getLIDForPN(phoneNumber);
            console.log(`  📍 LID obtenido: ${lid}`);
            
            if (lid) {
                // Probar getPNForLID (conversión inversa)
                const pnBack = await lidMapping.getPNForLID(lid);
                console.log(`  📞 PN recuperado: ${pnBack}`);
                
                // Verificar si la conversión es correcta
                if (pnBack === phoneNumber) {
                    console.log('  ✅ Conversión bidireccional exitosa');
                } else {
                    console.log('  ⚠️ Conversión bidireccional inconsistente');
                }
                
                // Mostrar formatos JID
                console.log(`  📧 Formato JID normal: ${phoneNumber}@s.whatsapp.net`);
                console.log(`  📧 Formato JID LID: ${lid}@lid`);
            } else {
                console.log('  ⚠️ No se obtuvo LID para este número');
            }
        } catch (error) {
            console.error(`  ❌ Error con ${phoneNumber}:`, error.message);
        }
    }
    
    // Mostrar mappings existentes
    console.log('\n📊 Explorando mappings existentes...');
    try {
        // Intentar acceder a los mappings internos
        if (lidMapping.store || lidMapping._store) {
            const store = lidMapping.store || lidMapping._store;
            console.log('📦 Store encontrado, tipo:', typeof store);
            
            // Si es un Map, mostrar algunas entradas
            if (store instanceof Map) {
                console.log('📋 Entradas en el Map:', store.size);
                let count = 0;
                for (const [key, value] of store.entries()) {
                    if (count < 10) { // Mostrar las primeras 10
                        console.log(`  ${key} -> ${value}`);
                        count++;
                    }
                }
                if (store.size > 10) {
                    console.log(`  ... y ${store.size - 10} más`);
                }
            }
        }
        
        // Intentar otros métodos para acceder a los datos
        if (typeof lidMapping.getAllMappings === 'function') {
            console.log('🔍 Intentando getAllMappings...');
            const allMappings = await lidMapping.getAllMappings();
            console.log('📋 Todos los mappings:', allMappings);
        }
        
    } catch (error) {
        console.log('⚠️ No se pudo acceder a los mappings internos:', error.message);
    }
    
    console.log('\n🏁 Debug completado');
}

// Ejecutar si se llama directamente
debugLidMapping().catch(console.error);

export { debugLidMapping };