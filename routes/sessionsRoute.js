import { Router } from "express";
import { body } from "express-validator";
import { updateUsernameHandler } from "../login/src/controllers/auth.controller.js";
import requestValidator from "./../middlewares/requestValidator.js";
import sessionValidator from "./../middlewares/sessionValidator.js";
import * as controller from "./../controllers/sessionsController.js";

const router = Router();

router.get("/list", requestValidator, controller.list);

router.get("/find/:id", sessionValidator, controller.find);

router.get("/status/:id", sessionValidator, controller.status);

router.post(
    "/add",
    body("id").notEmpty(),
    body("token").notEmpty(),
    updateUsernameHandler,
    requestValidator,
    controller.add,
);

router.delete("/delete/:id", sessionValidator, controller.del);

export default router;
