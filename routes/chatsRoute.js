// C:\api andres saya corregida cambios\baileys-api\routes\chatsRoute.js
import { Router } from "express";
import { body, query } from "express-validator";
import requestValidator from "./../middlewares/requestValidator.js";
import sessionValidator from "./../middlewares/sessionValidator.js";
import * as controller from "./../controllers/chatsController.js";
import getMessages from "./../controllers/getMessages.js";

const router = Router();

router.get(
    "/",
    query("id").notEmpty(),
    requestValidator,
    sessionValidator,
    controller.getList,
);
router.get(
    "/:jid",
    query("id").notEmpty(),
    requestValidator,
    sessionValidator,
    getMessages,
);
router.post(
    "/delete",
    query("id").notEmpty(),
    body("receiver").notEmpty(),
    body("message").notEmpty().isObject(),
    requestValidator,
    sessionValidator,
    controller.deleteChat,
);
router.post(
    "/send",
    query("id").notEmpty(),
    body("receiver").notEmpty(),
    body("message").notEmpty(),
    requestValidator,
    sessionValidator,
    controller.send,
);
router.post(
    "/reply",
    query("id").notEmpty(),
    body("receiver").notEmpty().isString(),
    body("messageContent").notEmpty().isObject(),
    body("quotedMessageId").notEmpty().isString(),
    body("isGroup").optional().isBoolean(),
    body("quotedChatJid").optional().isString(),
    body("isQuotedChatGroup").optional().isBoolean(),
    requestValidator,
    sessionValidator,
    controller.reply,
);
router.post(
    "/edit",
    query("id").notEmpty(),
    body("chatJid").notEmpty().isString(),
    body("messageId").notEmpty().isString(),
    body("newText").exists(),
    body("isGroup").optional().isBoolean(),
    requestValidator,
    sessionValidator,
    controller.editMessage,
);
router.post(
    "/pin",
    query("id").notEmpty(),
    body("chatJid").notEmpty().isString(),
    body("pinState").notEmpty().isBoolean(),
    body("isGroup").optional().isBoolean(),
    requestValidator,
    sessionValidator,
    controller.pinChat,
);
// Se eliminó la ruta para /messages/anchor
router.post(
    "/send-bulk",
    query("id").notEmpty(),
    body().isArray(),
    requestValidator,
    sessionValidator,
    controller.sendBulk,
);
router.post(
    "/forward",
    query("id").notEmpty(),
    body("forward").notEmpty().isObject(),
    body("receiver").notEmpty(),
    body("isGroup").isBoolean(),
    requestValidator,
    sessionValidator,
    controller.forward,
);
router.post(
    "/read",
    query("id").notEmpty(),
    body("keys").notEmpty().isArray(),
    requestValidator,
    sessionValidator,
    controller.read,
);
router.post(
    "/send-presence",
    query("id").notEmpty(),
    body("receiver").notEmpty(),
    body("presence")
        .notEmpty()
        .isIn(["unavailable", "available", "composing", "recording", "paused"]),
    requestValidator,
    sessionValidator,
    controller.sendPresence,
);
router.post(
    "/download-media",
    query("id").notEmpty(),
    body("remoteJid").notEmpty(),
    body("messageId").notEmpty(),
    requestValidator,
    sessionValidator,
    controller.downloadMedia,
);
router.post(
    "/labels/add-to-chat",
    query("id").notEmpty(),
    body("chatJid").notEmpty().isString(),
    body("labelId").notEmpty().isString(),
    body("isGroup").optional().isBoolean(),
    requestValidator,
    sessionValidator,
    controller.addLabelToChat,
);

router.post(
    "/labels/remove-from-chat",
    query("id").notEmpty(),
    body("chatJid").notEmpty().isString(),
    body("labelId").notEmpty().isString(),
    body("isGroup").optional().isBoolean(),
    requestValidator,
    sessionValidator,
    controller.removeLabelFromChat,
);

export default router;
