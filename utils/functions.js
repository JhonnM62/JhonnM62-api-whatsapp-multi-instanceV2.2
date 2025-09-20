import fs from 'fs'

const compareAndFilter = (array1, array2) => {
    return array1.filter((item) => {
        return array2.includes(item)
    })
}

const isUrlValid = (url) => {
    return Boolean(
        /^(?:(?:(?:https?|ftp):)\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(
            url
        )
    )
}

const fileExists = (path) => {
    return Boolean(fs.existsSync(path))
}

const deleteFile = async (path) => {
    return new Promise((resolve, reject) => {
        fs.unlink(path, (err) => {
            err ? reject(err) : resolve(true)
        })
    })
}

/**
 * Obtiene ambos formatos posibles de un JID usando signalRepository.lidMapping de Baileys
 * @param {string} jid - El JID original
 * @param {Object} session - La sesión de Baileys que contiene signalRepository
 * @returns {Array<string>} - Array con todos los formatos posibles del JID
 */
const getJidFormats = async (jid, session) => {
    console.log(`🔍 getJidFormats - Iniciando conversión para JID: ${jid}`);
    const formats = [jid]; // Siempre incluir el JID original
    
    try {
        // Verificación detallada de la disponibilidad de signalRepository
        console.log(`🔍 getJidFormats - Verificando session:`, {
            hasSession: !!session,
            hasSignalRepository: !!(session && session.signalRepository),
            hasGetLIDMappingStore: !!(session && session.signalRepository && typeof session.signalRepository.getLIDMappingStore === 'function'),
            sessionKeys: session ? Object.keys(session) : [],
            signalRepositoryKeys: session && session.signalRepository ? Object.keys(session.signalRepository) : []
        });

        // Verificar si signalRepository y getLIDMappingStore están disponibles
        if (!session || !session.signalRepository || typeof session.signalRepository.getLIDMappingStore !== 'function') {
            console.warn('⚠️ signalRepository.getLIDMappingStore no disponible, usando conversión básica');
            // Fallback a conversión básica si no está disponible
            if (jid.endsWith('@lid')) {
                const basicFormat = jid.replace('@lid', '@s.whatsapp.net');
                formats.push(basicFormat);
                console.log(`🔄 getJidFormats - Conversión básica @lid -> @s.whatsapp.net: ${basicFormat}`);
            } else if (jid.endsWith('@s.whatsapp.net')) {
                const basicFormat = jid.replace('@s.whatsapp.net', '@lid');
                formats.push(basicFormat);
                console.log(`🔄 getJidFormats - Conversión básica @s.whatsapp.net -> @lid: ${basicFormat}`);
            }
            console.log(`✅ getJidFormats - Formatos finales (básico):`, formats);
            return formats;
        }

        // Usar el método correcto para obtener LIDMappingStore
        const lidMapping = session.signalRepository.getLIDMappingStore();
        console.log(`🔍 getJidFormats - lidMapping disponible, métodos:`, Object.getOwnPropertyNames(lidMapping));
        
        if (jid.endsWith('@s.whatsapp.net')) {
            // Es un PN (Phone Number), intentar obtener el LID correspondiente
            const phoneNumber = jid.replace('@s.whatsapp.net', '');
            console.log(`📞 getJidFormats - Convirtiendo PN a LID: ${phoneNumber}`);
            
            try {
                const lid = await lidMapping.getLIDForPN(phoneNumber);
                console.log(`🔍 getJidFormats - Resultado getLIDForPN(${phoneNumber}):`, lid);
                
                if (lid) {
                    const lidFormat = `${lid}@lid`;
                    formats.push(lidFormat);
                    console.log(`✅ getJidFormats - LID encontrado: ${lidFormat}`);
                } else {
                    console.warn(`⚠️ getJidFormats - No se encontró LID para PN: ${phoneNumber}`);
                }
            } catch (error) {
                console.warn(`⚠️ getJidFormats - Error al obtener LID para PN ${phoneNumber}:`, error.message);
                console.warn(`⚠️ getJidFormats - Stack trace:`, error.stack);
            }
        } else if (jid.endsWith('@lid')) {
            // Es un LID, intentar obtener el PN correspondiente
            const lidNumber = jid.replace('@lid', '');
            console.log(`🆔 getJidFormats - Convirtiendo LID a PN: ${lidNumber}`);
            
            try {
                const phoneNumber = await lidMapping.getPNForLID(lidNumber);
                console.log(`🔍 getJidFormats - Resultado getPNForLID(${lidNumber}):`, phoneNumber);
                
                if (phoneNumber) {
                    const pnFormat = `${phoneNumber}@s.whatsapp.net`;
                    formats.push(pnFormat);
                    console.log(`✅ getJidFormats - PN encontrado: ${pnFormat}`);
                } else {
                    console.warn(`⚠️ getJidFormats - No se encontró PN para LID: ${lidNumber}`);
                }
            } catch (error) {
                console.warn(`⚠️ getJidFormats - Error al obtener PN para LID ${lidNumber}:`, error.message);
                console.warn(`⚠️ getJidFormats - Stack trace:`, error.stack);
            }
        }
        
        // Remover duplicados
        const uniqueFormats = [...new Set(formats)];
        console.log(`✅ getJidFormats - Formatos finales únicos:`, uniqueFormats);
        return uniqueFormats;
        
    } catch (error) {
        console.error('❌ Error en getJidFormats:', error);
        console.error('❌ Stack trace:', error.stack);
        return formats; // Retornar al menos el JID original
    }
};

export { compareAndFilter, isUrlValid, fileExists, deleteFile, getJidFormats }
