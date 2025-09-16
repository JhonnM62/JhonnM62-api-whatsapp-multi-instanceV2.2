// C:\api andres saya corregida cambios\baileys-api\controllers\chatsController.js
import {
    getSession,
    getChatList,
    isExists,
    sendMessage,
    formatPhone,
    formatGroup,
    readMessage,
    getMessageMedia,
    getStoreMessage,
} from "../whatsapp.js";
import response from "./../response.js";
import {
    compareAndFilter,
    fileExists,
    isUrlValid,
} from "./../utils/functions.js";

// Importar proto directamente de Baileys
import Baileys from "baileys"; // O '@whiskeysockets/baileys'
const { proto, generateWAMessageID } = Baileys.default || Baileys; // Intentar obtener proto y generateWAMessageID

const getList = (req, res) => {
    /* ... */ response(res, 200, true, "", getChatList(res.locals.sessionId));
};

const send = async (req, res) => {
    const session = getSession(res.locals.sessionId);
    if (!session) return response(res, 404, false, "Session not found.");
    const {
        receiver,
        message: messageContent,
        isGroup = false,
        quotedInfo,
    } = req.body;
    const formattedReceiver = isGroup
        ? formatGroup(receiver)
        : formatPhone(receiver);
    const typesMessage = ["image", "video", "audio", "document", "sticker"];
    const messageContentKeys =
        messageContent && typeof messageContent === "object"
            ? Object.keys(messageContent)
            : [];
    const filterTypeMessaje = compareAndFilter(
        messageContentKeys,
        typesMessage,
    );

    try {
        const exists = await isExists(session, formattedReceiver, isGroup);
        if (!exists)
            return response(
                res,
                400,
                false,
                "The receiver number does not exist.",
            );

        if (
            filterTypeMessaje.length > 0 &&
            messageContent &&
            messageContent[filterTypeMessaje[0]]
        ) {
            const url = messageContent[filterTypeMessaje[0]]?.url;
            if (!url || url.length === 0)
                return response(
                    res,
                    400,
                    false,
                    "The URL is invalid or empty for media message.",
                );
            if (!isUrlValid(url) && !fileExists(url))
                return response(
                    res,
                    400,
                    false,
                    "The file or URL for media message does not exist.",
                );
        }

        const messageOptions = {};
        if (quotedInfo && quotedInfo.messageId) {
            const chatJidForQuoted = quotedInfo.chatJid
                ? quotedInfo.isGroup
                    ? formatGroup(quotedInfo.chatJid)
                    : formatPhone(quotedInfo.chatJid)
                : formattedReceiver;
            let originalMessageToQuote;
            if (session.store?.loadMessage)
                originalMessageToQuote = await session.store.loadMessage(
                    chatJidForQuoted,
                    quotedInfo.messageId,
                );
            if (!originalMessageToQuote)
                console.warn(
                    `[send] Quoted message ID ${quotedInfo.messageId} not found. Sending without quote.`,
                );
            else messageOptions.quoted = originalMessageToQuote;
        }

        await sendMessage(
            session,
            formattedReceiver,
            messageContent,
            messageOptions,
            0,
        );
        response(res, 200, true, "The message has been successfully sent.");
    } catch (error) {
        console.error(`[send] Error:`, error?.message || error);
        response(
            res,
            500,
            false,
            `Failed to send the message. ${error?.message || "Unknown error"}`,
        );
    }
};

const reply = async (req, res) => {
    const session = getSession(res.locals.sessionId);
    if (!session) return response(res, 404, false, "Session not found.");
    const {
        receiver,
        messageContent,
        quotedMessageId,
        isGroup = false,
        quotedChatJid,
        isQuotedChatGroup,
    } = req.body;

    if (!receiver || !messageContent || !quotedMessageId) {
        return response(
            res,
            400,
            false,
            "Missing required fields: receiver, messageContent, quotedMessageId.",
        );
    }
    const formattedReceiver = isGroup
        ? formatGroup(receiver)
        : formatPhone(receiver);
    let chatJidForQuotedMessage = formattedReceiver;
    if (quotedChatJid) {
        chatJidForQuotedMessage =
            typeof isQuotedChatGroup !== "undefined" &&
            isQuotedChatGroup.toString() === "true"
                ? formatGroup(quotedChatJid)
                : formatPhone(quotedChatJid);
    }

    try {
        let originalMessageToQuote;
        if (session.store?.loadMessage)
            originalMessageToQuote = await session.store.loadMessage(
                chatJidForQuotedMessage,
                quotedMessageId,
            );
        if (!originalMessageToQuote)
            return response(
                res,
                404,
                false,
                `Message with ID ${quotedMessageId} not found in chat ${chatJidForQuotedMessage} to quote.`,
            );

        const messageOptions = { quoted: originalMessageToQuote };
        await sendMessage(
            session,
            formattedReceiver,
            messageContent,
            messageOptions,
            0,
        );
        response(res, 200, true, "Reply sent successfully.");
    } catch (error) {
        console.error(`[reply] Error:`, error?.message || error);
        response(
            res,
            500,
            false,
            `Failed to send reply. ${error?.message || "Unknown error"}`,
        );
    }
};

const editMessage = async (req, res) => {
    const sessionId = res.locals.sessionId;
    const session = getSession(sessionId);
    if (!session) return response(res, 404, false, "Session not found.");

    const { chatJid, messageId, newText, isGroup = false } = req.body;
    if (!chatJid || !messageId || typeof newText === "undefined") {
        return response(res, 400, false, "Missing fields.");
    }

    const formattedChatJid = isGroup
        ? formatGroup(chatJid)
        : formatPhone(chatJid);
    const messageToEditKey = {
        remoteJid: formattedChatJid,
        fromMe: true,
        id: messageId,
    };

    const newContentWithEditDirective = {
        text: newText,
        edit: messageToEditKey,
    };
    const messageOptions = {};

    try {
        let originalMessage;
        if (session.store?.loadMessage)
            originalMessage = await session.store.loadMessage(
                formattedChatJid,
                messageId,
            );
        if (!originalMessage)
            return response(
                res,
                404,
                false,
                `Message to edit (ID: ${messageId}) not found.`,
            );
        if (!originalMessage.key.fromMe)
            return response(res, 403, false, "Can only edit own messages.");

        const editResult = await sendMessage(
            session,
            formattedChatJid,
            newContentWithEditDirective,
            messageOptions,
            0,
        );
        response(res, 200, true, "Message edit request sent.", editResult);
    } catch (error) {
        console.error(
            `[editMessage] Error for session ${sessionId}:`,
            error?.message || error,
        );
        response(
            res,
            500,
            false,
            `Failed to edit. Reason: ${error?.message || "Unknown"}`,
        );
    }
};

const pinChat = async (req, res) => {
    const sessionId = res.locals.sessionId;
    const sessionObject = getSession(sessionId);
    if (!sessionObject) return response(res, 404, false, "Session not found.");

    const { chatJid, pinState, isGroup = false } = req.body;
    if (!chatJid || typeof pinState !== "boolean")
        return response(res, 400, false, "Missing chatJid or pinState.");

    const formattedChatJid = isGroup
        ? formatGroup(chatJid)
        : formatPhone(chatJid);
    try {
        if (typeof sessionObject.chatModify !== "function") {
            console.error(
                `[pinChat] CRITICAL ERROR: sessionObject.chatModify is NOT a function!`,
            );
            return response(
                res,
                500,
                false,
                "Internal server error: chatModify function not available.",
            );
        }
        await sessionObject.chatModify({ pin: pinState }, formattedChatJid);
        const action = pinState ? "pinned" : "unpinned";
        response(res, 200, true, `Chat ${action} successfully (command sent).`);
    } catch (error) {
        console.error(
            `[pinChat] Error for session ${sessionId}:`,
            error?.message || error,
        );
        response(
            res,
            500,
            false,
            `Failed to ${pinState ? "pin" : "unpin"} chat. Reason: ${error?.message || "Unknown error"}`,
        );
    }
};

// --- Mantener el resto de tus funciones del controlador: sendBulk, deleteChat, forward, read, sendPresence, downloadMedia ---
const sendBulk = async (req, res) => {
    const session = getSession(res.locals.sessionId);
    const errors = [];
    const entries = Array.isArray(req.body)
        ? req.body.entries()
        : Object.entries(req.body);
    for (const [key, data] of entries) {
        let { receiver, message, delay, isGroup = false, quotedInfo } = data;
        if (!receiver || !message) {
            errors.push({ key, message: "Receiver or message missing." });
            continue;
        }
        if (!delay || isNaN(delay)) delay = 1000;
        const formattedReceiver = isGroup
            ? formatGroup(receiver)
            : formatPhone(receiver);
        try {
            const exists = await isExists(session, formattedReceiver, isGroup);
            if (!exists) {
                errors.push({ key, message: "Receiver not on WhatsApp." });
                continue;
            }
            const messageOptions = {};
            if (quotedInfo && quotedInfo.messageId) {
                const chatJidForQuoted = quotedInfo.chatJid
                    ? quotedInfo.isGroup
                        ? formatGroup(quotedInfo.chatJid)
                        : formatPhone(quotedInfo.chatJid)
                    : formattedReceiver;
                const originalMessageToQuote = await session.store.loadMessage(
                    chatJidForQuoted,
                    quotedInfo.messageId,
                );
                if (originalMessageToQuote)
                    messageOptions.quoted = originalMessageToQuote;
            }
            await sendMessage(
                session,
                formattedReceiver,
                message,
                messageOptions,
                delay,
            );
        } catch (err) {
            errors.push({
                key,
                message: err?.message || "Unknown error during sendBulk item.",
            });
        }
    }
    if (errors.length === 0)
        return response(res, 200, true, "All messages sent.");
    const dataLength = Array.isArray(req.body)
        ? req.body.length
        : Object.keys(req.body).length;
    const isAllFailed = errors.length === dataLength;
    response(
        res,
        isAllFailed ? 500 : 200,
        !isAllFailed,
        isAllFailed ? "Failed to send all." : "Some sent.",
        { errors },
    );
};
const deleteChat = async (req, res) => {
    const session = getSession(res.locals.sessionId);
    const { receiver, isGroup, message } = req.body;
    if (!message || !message.id || !message.remoteJid) {
        return response(
            res,
            400,
            false,
            "Invalid message key provided for deletion.",
        );
    }
    try {
        await sendMessage(session, message.remoteJid, { delete: message });
        response(res, 200, true, "Message deletion request sent.");
    } catch (e) {
        console.error("[deleteChat] Error:", e);
        response(res, 500, false, "Failed to delete message.");
    }
};
const forward = async (req, res) => {
    const session = getSession(res.locals.sessionId);
    const { forward: forwardInfo, receiver, isGroup } = req.body;
    const { id, remoteJid } = forwardInfo;
    const jidFormat = isGroup ? formatGroup(receiver) : formatPhone(receiver);
    try {
        let messageToForward;
        if (session.store?.loadMessage)
            messageToForward = await session.store.loadMessage(remoteJid, id);
        if (!messageToForward)
            return response(
                res,
                404,
                false,
                "Original message to forward not found.",
            );
        await sendMessage(
            session,
            jidFormat,
            { forward: messageToForward },
            {},
            0,
        );
        response(res, 200, true, "Message forwarded.");
    } catch (e) {
        console.error("[forward] Error:", e);
        response(res, 500, false, "Failed to forward.");
    }
};
const read = async (req, res) => {
    const session = getSession(res.locals.sessionId);
    const { keys } = req.body;
    if (
        !Array.isArray(keys) ||
        keys.length === 0 ||
        !keys[0] ||
        !keys[0].id ||
        !keys[0].remoteJid
    ) {
        return response(res, 400, false, "Invalid 'keys' array provided.");
    }
    try {
        await readMessage(session, keys);
        response(res, 200, true, "Marked as read.");
    } catch (e) {
        console.error("[read] Error:", e);
        response(res, 500, false, "Failed to mark as read.");
    }
};
const sendPresence = async (req, res) => {
    const session = getSession(res.locals.sessionId);
    const { receiver, isGroup, presence } = req.body;
    const jidFormat = isGroup ? formatGroup(receiver) : formatPhone(receiver);
    try {
        await session.sendPresenceUpdate(presence, jidFormat);
        response(res, 200, true, "Presence sent.");
    } catch (e) {
        console.error("[sendPresence] Error:", e);
        response(res, 500, false, "Failed to send presence.");
    }
};
const downloadMedia = async (req, res) => {
    const session = getSession(res.locals.sessionId);
    const { remoteJid, messageId } = req.body;
    try {
        const message = await getStoreMessage(session, messageId, remoteJid);
        if (!message)
            return response(
                res,
                404,
                false,
                "Message not found to download media.",
            );
        const dataMessage = await getMessageMedia(session, message);
        response(res, 200, true, "Media downloaded.", dataMessage);
    } catch (e) {
        console.error("[downloadMedia] Error:", e);
        response(res, 500, false, "Error downloading media.");
    }
};

const addLabelToChat = async (req, res) => {
    const sessionId = res.locals.sessionId;
    const session = getSession(sessionId); // Tu objeto de sesión de Baileys

    if (!session) {
        return response(res, 404, false, "Session not found.");
    }

    // Asegurarse de que el método exista en la instancia de session
    if (typeof session.addChatLabel !== "function") {
        console.error(
            "[addLabelToChat] session.addChatLabel is not a function!",
        );
        return response(
            res,
            500,
            false,
            "Feature not available in this session object.",
        );
    }

    const { chatJid, labelId, isGroup = false } = req.body;

    if (!chatJid || !labelId) {
        return response(
            res,
            400,
            false,
            "Missing required fields: chatJid and labelId.",
        );
    }

    const formattedChatJid = isGroup
        ? formatGroup(chatJid)
        : formatPhone(chatJid);

    try {
        await session.addChatLabel(formattedChatJid, labelId);
        response(
            res,
            200,
            true,
            `Label ${labelId} added to chat ${formattedChatJid} successfully.`,
        );
    } catch (error) {
        console.error(
            `[addLabelToChat] Error adding label to chat for session ${sessionId}:`,
            error,
        );
        response(
            res,
            500,
            false,
            `Failed to add label. Reason: ${error?.message || "Unknown error"}`,
        );
    }
};

// >>>>> NUEVA FUNCIÓN: REMOVER ETIQUETA DE UN CHAT <<<<<
const removeLabelFromChat = async (req, res) => {
    const sessionId = res.locals.sessionId;
    const session = getSession(sessionId);

    if (!session) {
        return response(res, 404, false, "Session not found.");
    }

    // Verificar que el método exista en la instancia de Baileys
    if (typeof session.removeChatLabel !== "function") {
        console.error(
            "[removeLabelFromChat] session.removeChatLabel is not a function!",
        );
        return response(
            res,
            500,
            false,
            "Feature (removeChatLabel) not available in this session object.",
        );
    }

    const { chatJid, labelId, isGroup = false } = req.body;

    if (!chatJid || !labelId) {
        return response(
            res,
            400,
            false,
            "Missing required fields: chatJid and labelId.",
        );
    }

    const formattedChatJid = isGroup
        ? formatGroup(chatJid)
        : formatPhone(chatJid);

    try {
        await session.removeChatLabel(formattedChatJid, labelId);
        response(
            res,
            200,
            true,
            `Label ${labelId} removed from chat ${formattedChatJid} successfully.`,
        );
    } catch (error) {
        console.error(
            `[removeLabelFromChat] Error removing label from chat for session ${sessionId}:`,
            error,
        );
        response(
            res,
            500,
            false,
            `Failed to remove label. Reason: ${error?.message || "Unknown error"}`,
        );
    }
};

export {
    getList,
    send,
    sendBulk,
    deleteChat,
    read,
    forward,
    sendPresence,
    downloadMedia,
    reply,
    editMessage,
    pinChat,
    addLabelToChat,
    removeLabelFromChat,
    // No se exporta pinMessageInChat
};
