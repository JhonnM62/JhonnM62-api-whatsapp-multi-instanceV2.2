import { Router } from "express";
import {
    signinHandler,
    signupHandler,
    updateUsernameHandler,
    deleteUsernameHandler,
    renewMembership,
} from "../controllers/auth.controller.js";
import { checkExistingUser } from "../middlewares/verifySignup.js";

const router = Router();

router.use((req, res, next) => {
    res.header(
        "Access-Control-Allow-Headers",
        "x-access-token, Origin, Content-Type, Accept",
    );
    next();
});

router.post("/signup", [checkExistingUser], signupHandler);

router.post("/signin", signinHandler);
router.post("/updateUser", updateUsernameHandler);
router.post("/deleteUser", deleteUsernameHandler);
router.post("/renew-membership", renewMembership);

export default router;
