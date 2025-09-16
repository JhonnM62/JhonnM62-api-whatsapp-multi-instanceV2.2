// ./store/memory-store.js
import fs from "fs";

function makeInMemoryStore({ logger } = {}) {
    let chats = new Map(); // Usar let para poder reasignar en clearAllData si es necesario
    let messages = new Map(); // Usar let para poder reasignar
    let contacts = new Map(); // Usar let
    let groupMetadata = new Map(); // Usar let

    // console.log('[MEMORY_STORE] Store instance initialized.');

    const bind = (ev) => {
        ev.on("chats.set", ({ chats: newChats }) => {
            if (newChats && newChats.length > 0)
                for (const chat of newChats) chats.set(chat.id, chat);
        });
        ev.on("chats.upsert", (incomingChats) => {
            if (incomingChats && incomingChats.length > 0)
                for (const chat of incomingChats)
                    chats.set(chat.id, {
                        ...(chats.get(chat.id) || {}),
                        ...chat,
                    });
        });
        ev.on("chats.update", (updates) => {
            if (updates && updates.length > 0)
                for (const partialChat of updates)
                    if (partialChat.id)
                        chats.set(partialChat.id, {
                            ...(chats.get(partialChat.id) || {}),
                            ...partialChat,
                        });
        });
        ev.on("chats.delete", (deletedChatIds) => {
            if (deletedChatIds && deletedChatIds.length > 0)
                for (const id of deletedChatIds) chats.delete(id);
        });
        ev.on("messages.upsert", ({ messages: newMessages }) => {
            for (const msg of newMessages) {
                const jid = msg.key.remoteJid;
                if (!messages.has(jid)) messages.set(jid, new Map());
                messages.get(jid).set(msg.key.id, msg);
            }
        });
        ev.on("contacts.set", ({ contacts: newContacts }) => {
            if (newContacts)
                for (const contact of newContacts)
                    contacts.set(contact.id, contact);
        });
        ev.on("contacts.upsert", (newContacts) => {
            if (newContacts)
                for (const contact of newContacts)
                    contacts.set(contact.id, {
                        ...(contacts.get(contact.id) || {}),
                        ...contact,
                    });
        });
        ev.on("groups.update", (updates) => {
            if (updates)
                for (const update of updates)
                    if (update.id)
                        groupMetadata.set(update.id, {
                            ...(groupMetadata.get(update.id) || {}),
                            ...update,
                        });
        });
    };

    const readFromFile = (file) => {
        if (!fs.existsSync(file)) {
            logger?.info(
                `[MEMORY_STORE] Store file ${file} not found, starting fresh.`,
            );
            return;
        }
        try {
            const fileContent = fs.readFileSync(file, { encoding: "utf-8" });
            if (!fileContent.trim()) {
                logger?.info(`[MEMORY_STORE] Store file ${file} is empty.`);
                return;
            }
            const raw = JSON.parse(fileContent);
            logger?.info(`[MEMORY_STORE] Reading store from file: ${file}`);

            if (raw.chats && Array.isArray(raw.chats)) {
                try {
                    new Map(raw.chats).forEach((chat, jid) =>
                        chats.set(jid, chat),
                    );
                } catch (e) {
                    logger?.warn(
                        `[MEMORY_STORE] Error processing chats as Map from file, trying individually: ${e.message}`,
                    );
                    if (Array.isArray(raw.chats))
                        raw.chats.forEach((entry) => {
                            if (Array.isArray(entry) && entry.length === 2)
                                chats.set(entry[0], entry[1]);
                        });
                }
            }
            logger?.info(
                `[MEMORY_STORE] Loaded ${chats.size} chats from file.`,
            );

            if (raw.messages) {
                Object.entries(raw.messages).forEach(([jid, msgsArray]) => {
                    if (Array.isArray(msgsArray)) {
                        try {
                            messages.set(jid, new Map(msgsArray));
                        } catch (e) {
                            logger?.error(
                                `[MEMORY_STORE] Error processing messages for JID ${jid} from file: ${e.message}`,
                            );
                        }
                    }
                });
            }
            logger?.info(
                `[MEMORY_STORE] Loaded messages for ${messages.size} JIDs from file.`,
            );

            const loadMapData = (key, targetMap) => {
                if (raw[key]) {
                    if (Array.isArray(raw[key]))
                        try {
                            new Map(raw[key]).forEach((value, id) =>
                                targetMap.set(id, value),
                            );
                        } catch (e) {
                            logger?.warn(
                                `[MEMORY_STORE] Error loading ${key} as Map: ${e.message}`,
                            );
                        }
                    else if (typeof raw[key] === "object" && raw[key] !== null)
                        Object.entries(raw[key]).forEach(([id, value]) =>
                            targetMap.set(id, value),
                        );
                }
            };
            loadMapData("contacts", contacts);
            loadMapData("groupMetadata", groupMetadata);
            logger?.info(
                `[MEMORY_STORE] Loaded ${contacts.size} contacts, ${groupMetadata.size} groupMetadata.`,
            );
        } catch (err) {
            logger?.error(
                `[MEMORY_STORE] Failed to read or parse store file ${file}: ${err.message}`,
            );
        }
    };

    const writeToFile = (file) => {
        // logger?.debug(`[MEMORY_STORE] Attempting to write store to file: ${file}`);
        try {
            const directory = path.dirname(file); // Necesitas importar 'path'
            if (!fs.existsSync(directory)) {
                fs.mkdirSync(directory, { recursive: true });
            }
            const data = {
                chats: [...chats.entries()],
                messages: Object.fromEntries(
                    [...messages.entries()].map(([jid, msgsMap]) => [
                        jid,
                        [...msgsMap.entries()],
                    ]),
                ),
                contacts: [...contacts.entries()],
                groupMetadata: [...groupMetadata.entries()],
            };
            fs.writeFileSync(file, JSON.stringify(data, null, 2));
            // logger?.info(`[MEMORY_STORE] Store successfully written to ${file}. Chats: ${chats.size}, Messages JIDs: ${messages.size}`);
        } catch (err) {
            logger?.error(
                `[MEMORY_STORE] Failed to write store to file ${file}: ${err.message}`,
            );
        }
    };

    const loadMessage = async (jid, id) => {
        const msgs = messages.get(jid);
        return msgs?.get(id);
    };

    const loadMessages = async (jid, count, cursor) => {
        const msgMap = messages.get(jid);
        if (!msgMap) {
            return [];
        }
        let allMsgs = Array.from(msgMap.values());
        allMsgs.sort(
            (a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0),
        ); // Antiguo primero
        let cursorIndex = -1;
        if (cursor?.before?.id) {
            cursorIndex = allMsgs.findIndex(
                (msg) =>
                    msg.key.id === cursor.before.id &&
                    msg.key.fromMe === cursor.before.fromMe,
            );
        }
        let startIndex = cursorIndex !== -1 ? cursorIndex + 1 : 0;
        return allMsgs.slice(startIndex, startIndex + count);
    };

    // >>>>> NUEVA FUNCIÓN para limpiar solo los mensajes <<<<<
    const clearAllMessages = () => {
        logger?.info(
            "[MEMORY_STORE] Clearing all messages from memory store...",
        );
        messages.clear(); // Vacía el Map de mensajes
        logger?.info(
            `[MEMORY_STORE] All messages cleared. Messages JIDs count: ${messages.size}`,
        );
    };
    // >>>>> FIN DE NUEVA FUNCIÓN <<<<<

    return {
        chats,
        messages,
        contacts,
        groupMetadata,
        bind,
        readFromFile,
        writeToFile,
        loadMessage,
        loadMessages,
        clearAllMessages, // <<<< EXPORTAR NUEVA FUNCIÓN
    };
}
// Necesitas importar path para path.dirname(file) en writeToFile
import path from "path";
export default makeInMemoryStore;
