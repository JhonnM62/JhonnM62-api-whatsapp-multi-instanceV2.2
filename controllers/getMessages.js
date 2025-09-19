import { getSession, formatGroup, formatPhone } from "../whatsapp.js";
import { getJidFormats } from "../utils/functions.js";
import response from "./../response.js";

const getMessages = async (req, res) => {
    const sessionId = res.locals.sessionId;
    const session = getSession(sessionId);

    const { jid } = req.params;
    const {
        limit = 50,
        cursorId = null,
        cursorFromMe = null,
        isGroup = false,
    } = req.query;

    // 🔍 LOG: Parámetros de entrada
    console.log(`[${sessionId}] 📥 getMessages - Parámetros recibidos:`, {
        jid,
        limit,
        cursorId,
        cursorFromMe,
        isGroup,
        sessionId
    });

    const isGroupBool = isGroup === "true";
    const jidFormat = isGroupBool ? formatGroup(jid) : formatPhone(jid);

    console.log(`[${sessionId}] 🔄 getMessages - JID formateado:`, {
        original: jid,
        formatted: jidFormat,
        isGroup: isGroupBool
    });

    const cursor = {};

    if (cursorId) {
        cursor.before = {
            id: cursorId,
            fromMe: Boolean(cursorFromMe && cursorFromMe === "true"),
        };
        console.log(`[${sessionId}] ⏮️ getMessages - Cursor configurado:`, cursor);
    }

    try {
        const useCursor = "before" in cursor ? cursor : null;
        
        // 🔍 LOG: Antes de cargar mensajes
        console.log(`[${sessionId}] 📂 getMessages - Cargando mensajes del store...`, {
            jidFormat,
            limit,
            useCursor
        });

        // Obtener ambos formatos posibles del JID (para compatibilidad @lid/@s.whatsapp.net)
        const jidFormats = getJidFormats(jidFormat);
        console.log(`[${sessionId}] 🔄 getMessages - Formatos JID a probar:`, jidFormats);

        let messages = [];
        let usedJidFormat = jidFormat;

        // Intentar cargar mensajes con cada formato posible
        for (const currentJidFormat of jidFormats) {
            try {
                console.log(`[${sessionId}] 🔍 getMessages - Probando formato JID:`, currentJidFormat);
                
                const currentMessages = await session.store.loadMessages(
                    currentJidFormat,
                    limit,
                    useCursor,
                );

                if (currentMessages && currentMessages.length > 0) {
                    messages = currentMessages;
                    usedJidFormat = currentJidFormat;
                    console.log(`[${sessionId}] ✅ getMessages - Mensajes encontrados con formato:`, {
                        format: currentJidFormat,
                        count: messages.length
                    });
                    break; // Salir del bucle si encontramos mensajes
                } else {
                    console.log(`[${sessionId}] ⚠️ getMessages - No se encontraron mensajes con formato:`, currentJidFormat);
                }
            } catch (formatError) {
                console.log(`[${sessionId}] ⚠️ getMessages - Error con formato ${currentJidFormat}:`, formatError.message);
                continue; // Continuar con el siguiente formato
            }
        }

        // 🔍 LOG: Mensajes obtenidos
        console.log(`[${sessionId}] 📨 getMessages - Mensajes obtenidos:`, {
            count: messages.length,
            usedJidFormat,
            originalJidFormat: jidFormat,
            firstMessage: messages[0] ? {
                id: messages[0].key?.id,
                fromMe: messages[0].key?.fromMe,
                timestamp: messages[0].messageTimestamp,
                hasMessage: !!messages[0].message
            } : null,
            lastMessage: messages[messages.length - 1] ? {
                id: messages[messages.length - 1].key?.id,
                fromMe: messages[messages.length - 1].key?.fromMe,
                timestamp: messages[messages.length - 1].messageTimestamp,
                hasMessage: !!messages[messages.length - 1].message
            } : null
        });

        // 🔍 LOG: Análisis de fromMe en todos los mensajes
        const fromMeStats = messages.reduce((stats, msg) => {
            const fromMe = msg.key?.fromMe;
            if (fromMe === true) stats.fromMeTrue++;
            else if (fromMe === false) stats.fromMeFalse++;
            else stats.fromMeUndefined++;
            return stats;
        }, { fromMeTrue: 0, fromMeFalse: 0, fromMeUndefined: 0 });

        console.log(`[${sessionId}] 📊 getMessages - Estadísticas fromMe:`, fromMeStats);

        response(res, 200, true, "", messages);
    } catch (error) {
        console.error(`[${sessionId}] ❌ getMessages - Error:`, error);
        response(res, 500, false, "Failed to load messages.");
    }
};

export default getMessages;
