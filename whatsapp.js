// whatsapp.js
import { rmSync, readdir, readdirSync, existsSync, mkdirSync } from "fs";
import { promises as fsPromises } from "fs";
import { join } from "path";
import pino from "pino";
import makeWASocketModule, {
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    delay,
    downloadMediaMessage,
    getAggregateVotesInPollMessage,
    fetchLatestBaileysVersion,
    WAMessageStatus,
} from "baileys"; // Asegúrate que el nombre del paquete sea correcto (ej. '@whiskeysockets/baileys')

// Importar moment-timezone para manejo de zonas horarias
// NOTA: Necesitarás instalar esta dependencia con:
// npm install moment-timezone

let moment;
try {
    // Intentar importar moment-timezone
    const momentModule = await import("moment-timezone");
    moment = momentModule.default;
    console.log("✅ Biblioteca moment-timezone cargada correctamente");
} catch (error) {
    console.warn(
        "⚠️ No se pudo cargar moment-timezone. Se usará formato de fecha básico.",
    );
    console.warn(
        "Para una mejor experiencia, instala la dependencia: npm install moment-timezone",
    );
    // Definir un objeto básico de fallback
    moment = {
        tz: (date, timezone) => {
            return {
                format: (format) => {
                    try {
                        return new Intl.DateTimeFormat("es-ES", {
                            timeZone: timezone,
                            year: "numeric",
                            month: "numeric",
                            day: "numeric",
                            hour: "numeric",
                            minute: "numeric",
                            second: "numeric",
                            hour12: true,
                        }).format(date instanceof Date ? date : new Date(date));
                    } catch (error) {
                        return (
                            date instanceof Date ? date : new Date(date)
                        ).toLocaleString();
                    }
                },
            };
        },
    };
}

import proto from "baileys"; // Esta importación de proto te funcionaba

import makeInMemoryStore from "./store/memory-store.js";
import { toDataURL } from "qrcode";
import __dirname from "./dirname.js";
import response from "./response.js";
import { downloadImage } from "./utils/download.js";
import axios from "axios";
import NodeCache from "node-cache";

const msgRetryCounterCache = new NodeCache({ stdTTL: 3600 }); // TTL de 1 hora para evitar acumulación
const sessions = new Map();
const retries = new Map();
const APP_WEBHOOK_ALLOWED_EVENTS = (
    process.env.APP_WEBHOOK_ALLOWED_EVENTS || ""
).split(",");

// --- CONFIGURACIÓN PARA RECONEXIÓN Y ARRANQUE ---
// Si MAX_RETRIES no está en .env, por defecto a 5
const MAX_RECONNECT_RETRIES = parseInt(process.env.MAX_RETRIES || "5");
// Si RECONNECT_INTERVAL no está en .env, por defecto a 10 segundos
const INITIAL_RECONNECT_INTERVAL = parseInt(
    process.env.RECONNECT_INTERVAL || "10000",
);
const MAX_RECONNECT_INTERVAL = parseInt(
    process.env.MAX_RECONNECT_INTERVAL_ENV || "120000",
); // Máximo 2 minutos
// Retraso entre el inicio de cada sesión recuperada por init()
const SESSION_INIT_DELAY = parseInt(process.env.SESSION_INIT_DELAY || "1000");
// --- FIN CONFIGURACIÓN ---

// --- NUEVA CONFIGURACIÓN PARA LIMPIEZA PROGRAMADA ---
// Hora específica del día para limpiar el historial (formato 24h, por defecto 3 AM)
const CLEANUP_HOUR = parseInt(process.env.MESSAGE_STORE_CLEANUP_HOUR || "3");
const CLEANUP_MINUTE = parseInt(
    process.env.MESSAGE_STORE_CLEANUP_MINUTE || "0",
);

// También mantener el intervalo como respaldo (en horas, 24h por defecto)
const CLEANUP_INTERVAL_HOURS = parseInt(
    process.env.MESSAGE_STORE_CLEAR_INTERVAL_HOURS || "24",
);

// Configuración de zona horaria (por defecto: UTC)
const TIMEZONE = process.env.TIMEZONE || "UTC";

// Rutas de archivos para almacenar información de limpieza persistente
const getLastCleanupFilePath = (sessionId) =>
    join(sessionsDir(), `${sessionId}_last_cleanup.json`);

// Mapa para rastrear cuándo fue la última limpieza por sesión
const lastCleanupTime = new Map();
// Mapa para almacenar los timers de limpieza programada
const scheduledCleanupTimers = new Map();
// Mapa para almacenar los timers de limpieza por intervalo (respaldo)
const intervalCleanupTimers = new Map();
// Mapa para almacenar los timers de verificación de memoria
const memoryCheckTimers = new Map();
// --- FIN NUEVA CONFIGURACIÓN ---

// Función para formatear una fecha en la zona horaria configurada
const formatTimeInUserTimezone = (date) => {
    try {
        return moment.tz(date, TIMEZONE).format("DD MMM YYYY, h:mm:ss A z");
    } catch (error) {
        console.error(`Error al formatear fecha: ${error.message}`);
        return `${date.toLocaleString()} (${TIMEZONE})`;
    }
};

const sessionsDir = (sessionId = "") =>
    join(__dirname, "sessions", sessionId ? sessionId : "");
const getStorePath = (sessionId) =>
    join(sessionsDir(), `${sessionId}_store.json`);

const isSessionExists = (sessionId) => sessions.has(sessionId);
const isSessionConnected = (sessionId) =>
    sessions.get(sessionId)?.ws?.socket?.readyState === 1;

const shouldReconnect = (sessionId) => {
    let currentAttempts = retries.get(sessionId) || 0;

    // Si MAX_RECONNECT_RETRIES es -1, permitir reconexiones ilimitadas
    if (MAX_RECONNECT_RETRIES === -1) {
        currentAttempts++;
        retries.set(sessionId, currentAttempts);
        console.log(
            `[${sessionId}] Reconnect attempt ${currentAttempts} (unlimited reconnects enabled).`,
        );
        return true;
    }

    // De lo contrario, verificar si se ha alcanzado el máximo
    if (currentAttempts < MAX_RECONNECT_RETRIES) {
        currentAttempts++;
        retries.set(sessionId, currentAttempts);
        console.log(
            `[${sessionId}] Reconnect attempt ${currentAttempts} of ${MAX_RECONNECT_RETRIES}.`,
        );
        return true;
    }

    console.log(
        `[${sessionId}] Max reconnect retries (${MAX_RECONNECT_RETRIES}) reached. Cleaning up and removing session completely.`,
    );

    // Cuando se alcanza el máximo, forzar la eliminación de la sesión de inmediato
    try {
        deleteSession(sessionId);
    } catch (error) {
        console.error(
            `[${sessionId}] Error during forced cleanup: ${error.message}`,
        );
    }

    return false;
};

const getReconnectDelay = (sessionId) => {
    const attempts = retries.get(sessionId) || 0;
    const calculatedDelay = Math.min(
        INITIAL_RECONNECT_INTERVAL * Math.pow(2, Math.max(0, attempts - 1)),
        MAX_RECONNECT_INTERVAL,
    );
    console.log(
        `[${sessionId}] Next reconnect delay will be: ${calculatedDelay / 1000}s`,
    );
    return calculatedDelay;
};

const callWebhook = async (instance, eventType, eventData) => {
    if (
        APP_WEBHOOK_ALLOWED_EVENTS.includes("ALL") ||
        APP_WEBHOOK_ALLOWED_EVENTS.includes(eventType)
    ) {
        await webhook(instance, eventType, eventData);
    }
};

const webhook = async (instance, type, data) => {
    if (process.env.APP_WEBHOOK_URL) {
        axios
            .post(`${process.env.APP_WEBHOOK_URL}`, { instance, type, data })
            .catch((error) =>
                console.error(
                    `[WEBHOOK] Error: ${error.message} for event ${type} to ${process.env.APP_WEBHOOK_URL}`,
                ),
            );
    }
};

// Función para guardar el tiempo de la última limpieza de forma persistente
const saveLastCleanupTime = async (sessionId, timestamp) => {
    try {
        // Verificar si ya se guardó recientemente (en los últimos 5 minutos)
        const lastSavedTime = lastCleanupTime.get(sessionId);
        if (lastSavedTime) {
            const timeSinceLastSave =
                timestamp.getTime() - lastSavedTime.getTime();
            // Si se guardó hace menos de 5 minutos y no es una nueva limpieza, evitar guardar de nuevo
            if (timeSinceLastSave < 300000) {
                // 5 minutos en milisegundos
                return; // Evitar guardados frecuentes
            }
        }

        const filePath = getLastCleanupFilePath(sessionId);
        // Log detallado para diagnóstico
        console.log(
            `[${sessionId}] Intentando guardar registro de limpieza en: ${filePath}`,
        );

        try {
            // Verificar permisos de escritura en el directorio
            const dirPath = sessionsDir();
            await fsPromises
                .access(dirPath, fsPromises.constants.W_OK)
                .catch((e) => {
                    console.error(
                        `[${sessionId}] ERROR DE PERMISOS: No se puede escribir en ${dirPath}: ${e.message}`,
                    );
                    throw e;
                });

            // Intentar escribir el archivo
            await fsPromises.writeFile(
                filePath,
                JSON.stringify({ lastCleanup: timestamp.toISOString() }),
                "utf8",
            );

            console.log(
                `[${sessionId}] ✅ Registro de limpieza guardado correctamente en: ${filePath}`,
            );
        } catch (writeError) {
            console.error(
                `[${sessionId}] ERROR CRÍTICO: No se pudo escribir el archivo de limpieza: ${writeError.message}`,
            );
            // Intentar crear el directorio si no existe
            if (writeError.code === "ENOENT") {
                console.log(
                    `[${sessionId}] Intentando crear directorio: ${sessionsDir()}`,
                );
                try {
                    await fsPromises.mkdir(sessionsDir(), { recursive: true });
                    // Intentar escribir de nuevo
                    await fsPromises.writeFile(
                        filePath,
                        JSON.stringify({
                            lastCleanup: timestamp.toISOString(),
                        }),
                        "utf8",
                    );
                    console.log(
                        `[${sessionId}] ✅ Directorio creado y archivo guardado`,
                    );
                } catch (mkdirError) {
                    console.error(
                        `[${sessionId}] ERROR: No se pudo crear el directorio: ${mkdirError.message}`,
                    );
                }
            }
        }
    } catch (error) {
        console.error(
            `[${sessionId}] ERROR GENERAL: Error al guardar tiempo de limpieza: ${error.message}`,
        );
    }
};

// Función para cargar el tiempo de la última limpieza desde el almacenamiento persistente
const loadLastCleanupTime = async (sessionId) => {
    try {
        const filePath = getLastCleanupFilePath(sessionId);
        if (!existsSync(filePath)) {
            return null;
        }

        const data = await fsPromises.readFile(filePath, "utf8");

        // Intentar analizar el JSON y validar su estructura
        try {
            const parsed = JSON.parse(data);
            if (!parsed || !parsed.lastCleanup) {
                console.log(
                    `[${sessionId}] Invalid cleanup time data format, ignoring file`,
                );
                // Eliminar el archivo corrupto
                await fsPromises.unlink(filePath).catch(() => {});
                return null;
            }
            return new Date(parsed.lastCleanup);
        } catch (parseError) {
            // Si el archivo está corrupto, eliminarlo
            console.error(
                `[${sessionId}] Cleanup time file corrupted, removing: ${parseError.message}`,
            );
            await fsPromises.unlink(filePath).catch(() => {});
            return null;
        }
    } catch (error) {
        console.error(
            `[${sessionId}] Error loading last cleanup time: ${error.message}`,
        );
        return null;
    }
};

// Función para verificar si debería ejecutarse una limpieza inmediata después del reinicio
const shouldPerformImmediateCleanup = (lastCleanupDate) => {
    if (!lastCleanupDate) return true; // Si no hay registro previo, limpiar

    const now = new Date();
    // Evitar limpieza si la última fue hace menos de 5 minutos (protección contra reinicios rápidos)
    const minutesSinceLastCleanup = (now - lastCleanupDate) / (1000 * 60);
    if (minutesSinceLastCleanup < 5) {
        console.log(
            `Skipping immediate cleanup after restart as last cleanup was only ${minutesSinceLastCleanup.toFixed(1)} minutes ago`,
        );
        return false;
    }

    const hoursSinceLastCleanup = minutesSinceLastCleanup / 60;

    // Si ha pasado más tiempo que el intervalo configurado, limpiar
    if (hoursSinceLastCleanup >= CLEANUP_INTERVAL_HOURS) return true;

    // Verificar si se perdió la hora programada entre la última limpieza y ahora
    const lastScheduledTime = new Date(
        lastCleanupDate.getFullYear(),
        lastCleanupDate.getMonth(),
        lastCleanupDate.getDate(),
        CLEANUP_HOUR,
        CLEANUP_MINUTE,
    );

    // Si la última limpieza fue antes de la hora programada de ese día
    // y ahora es después de la hora programada, entonces se perdió una limpieza
    if (lastCleanupDate < lastScheduledTime && now > lastScheduledTime)
        return true;

    // Si ha pasado al menos un día y la hora actual es posterior a la hora programada
    const nextScheduledDay = new Date(lastScheduledTime);
    nextScheduledDay.setDate(nextScheduledDay.getDate() + 1);
    if (now > nextScheduledDay) return true;

    return false;
};

// Función para realizar la limpieza del historial
const performMessageStoreCleanup = async (
    sessionId,
    storeInstance,
    storePath,
    pinoLogger,
    forceCritical = false,
) => {
    console.log(
        `[${sessionId}] 🧹 Iniciando limpieza del historial de mensajes...`,
    );

    // Definir la variable al inicio para que esté disponible en todo el ámbito
    let formattedLocalTime = "formato no disponible";

    if (
        !storeInstance ||
        typeof storeInstance.clearAllMessages !== "function"
    ) {
        console.error(
            `[${sessionId}] ❌ No se puede realizar limpieza: store o método clearAllMessages no disponible`,
        );
        return false;
    }

    // Verificar si ya se realizó una limpieza recientemente (en los últimos 5 minutos)
    const lastCleanup = lastCleanupTime.get(sessionId);
    if (lastCleanup && !forceCritical) {
        const now = new Date();
        const timeSinceLastCleanup = now.getTime() - lastCleanup.getTime();
        if (timeSinceLastCleanup < 300000) {
            // 5 minutos en milisegundos
            console.log(
                `[${sessionId}] ⏱️ Omitiendo limpieza (última realizada hace ${Math.round(timeSinceLastCleanup / 1000)} segundos)`,
            );
            return false;
        }
    } else if (forceCritical) {
        console.log(
            `[${sessionId}] ⚠️ Forzando limpieza crítica por alta memoria, ignorando límite de tiempo`,
        );
    }

    try {
        // Verificar tamaño del store antes de limpiar
        let initialSize = "desconocido";
        try {
            if (storeInstance.chats?.size) {
                initialSize = `${storeInstance.chats.size} chats`;
            } else if (storeInstance.messages?.size) {
                initialSize = `${storeInstance.messages.size} mensajes`;
            }
        } catch (e) {
            console.log(
                `[${sessionId}] No se pudo determinar tamaño inicial del store`,
            );
        }

        // Realizar la limpieza en memoria
        console.log(
            `[${sessionId}] 🧹 Limpiando mensajes en memoria (tamaño inicial: ${initialSize})...`,
        );
        storeInstance.clearAllMessages();

        // Guardar el estado limpio si el archivo existe
        if (existsSync(storePath)) {
            console.log(
                `[${sessionId}] 💾 Guardando store limpio en: ${storePath}`,
            );
            storeInstance.writeToFile(storePath);
            console.log(
                `[${sessionId}] ✅ Historial limpiado y archivo store actualizado`,
            );
        } else {
            console.warn(
                `[${sessionId}] ⚠️ Historial limpiado en memoria, pero el archivo store no existe: ${storePath}`,
            );
        }

        // Actualizar el tiempo de la última limpieza en memoria y persistente
        const now = new Date();
        lastCleanupTime.set(sessionId, now);

        console.log(
            `[${sessionId}] 📝 Guardando registro de última limpieza...`,
        );
        try {
            // Asegurar que el directorio existe
            const cleanupDir = sessionsDir();
            if (!existsSync(cleanupDir)) {
                console.log(
                    `[${sessionId}] 📁 Creando directorio de sesiones: ${cleanupDir}`,
                );
                mkdirSync(cleanupDir, { recursive: true });
            }

            // Ruta absoluta para el archivo de registro
            const filePath = getLastCleanupFilePath(sessionId);
            console.log(
                `[${sessionId}] 📄 Ruta del archivo de registro: ${filePath}`,
            );

            // Formatear la hora local para registro
            try {
                formattedLocalTime = formatTimeInUserTimezone(now);
            } catch (formatError) {
                console.error(
                    `[${sessionId}] Error al formatear hora local: ${formatError.message}`,
                );
                formattedLocalTime = now.toLocaleString() + ` (${TIMEZONE})`;
            }

            // Contenido del archivo
            const content = JSON.stringify(
                {
                    lastCleanup: now.toISOString(),
                    cleanupInfo: {
                        initialStoreSize: initialSize,
                        cleanupTimeUTC: now.toLocaleString(),
                        localTime: formattedLocalTime,
                        timezone: TIMEZONE,
                        forcedCritical: forceCritical,
                    },
                },
                null,
                2,
            );

            // Usar método asíncrono directamente, ya que funciona
            await fsPromises.writeFile(filePath, content, "utf8");
            console.log(
                `[${sessionId}] ✅ Registro de limpieza guardado exitosamente`,
            );

            // Verificar que el archivo se creó correctamente
            if (existsSync(filePath)) {
                try {
                    const stats = await fsPromises.stat(filePath);
                    console.log(
                        `[${sessionId}] 📊 Archivo creado: ${filePath} (${stats.size} bytes)`,
                    );
                } catch (error) {
                    console.log(
                        `[${sessionId}] No se pudo verificar tamaño del archivo: ${error.message}`,
                    );
                }
            } else {
                console.error(
                    `[${sessionId}] ❌ ERROR: El archivo no existe después de escribirlo`,
                );
            }
        } catch (writeError) {
            console.error(
                `[${sessionId}] ❌ ERROR CRÍTICO: No se pudo guardar el registro: ${writeError.message}`,
            );

            // Información de depuración adicional
            console.error(`[${sessionId}] Información de depuración:`);
            try {
                console.error(
                    `- Directorio existe: ${existsSync(sessionsDir())}`,
                );
                await fsPromises.access(
                    sessionsDir(),
                    fsPromises.constants.W_OK,
                );
                console.error(`- Permisos de escritura: OK`);
            } catch (error) {
                console.error(
                    `- Permisos de escritura: ERROR - ${error.message}`,
                );
            }
            try {
                console.error(
                    `- Espacio en disco: ${process.memoryUsage().heapTotal / (1024 * 1024)} MB total`,
                );
            } catch (error) {
                console.error(
                    `- No se pudo verificar memoria: ${error.message}`,
                );
            }
        }

        // Mostrar hora local formateada correctamente
        console.log(
            `[${sessionId}] ✅ Limpieza completada exitosamente a las ${now.toISOString()} (${formattedLocalTime})`,
        );
        return true;
    } catch (error) {
        console.error(
            `[${sessionId}] ❌ ERROR durante limpieza: ${error.message || error}`,
        );
        console.error(`[${sessionId}] Stack trace: ${error.stack}`);

        // A pesar del error, intentar mostrar alguna información sobre la hora
        try {
            formattedLocalTime = formatTimeInUserTimezone(new Date());
        } catch (e) {
            formattedLocalTime = new Date().toLocaleString() + ` (${TIMEZONE})`;
        }

        console.log(
            `[${sessionId}] ⚠️ Limpieza no completada. Hora actual: ${formattedLocalTime}`,
        );
        return false;
    }
};

// Función para calcular el próximo tiempo de limpieza programada
const getNextScheduledCleanupTime = () => {
    console.log(
        `⏰ Calculando próxima limpieza usando zona horaria: ${TIMEZONE}`,
    );

    try {
        // Obtener momento actual en la zona horaria configurada
        const now = moment();

        // Crear un momento para hoy a la hora configurada en la zona horaria del usuario
        const targetTime = moment.tz(TIMEZONE);
        targetTime.hours(CLEANUP_HOUR);
        targetTime.minutes(CLEANUP_MINUTE);
        targetTime.seconds(0);
        targetTime.milliseconds(0);

        console.log(
            `⏰ Hora objetivo en ${TIMEZONE}: ${targetTime.format("YYYY-MM-DD HH:mm:ss z")}`,
        );

        // Si la hora objetivo ya pasó hoy, programar para mañana
        if (now.isAfter(targetTime)) {
            targetTime.add(1, "day");
            console.log(
                `⏰ Hora objetivo ya pasó hoy, ajustando para mañana: ${targetTime.format("YYYY-MM-DD HH:mm:ss z")}`,
            );
        }

        // Convertir a UTC para JavaScript
        const targetTimeJS = new Date(targetTime.toISOString());
        console.log(`⏰ Hora objetivo en UTC: ${targetTimeJS.toISOString()}`);

        return targetTimeJS;
    } catch (error) {
        console.error(`Error al calcular próxima limpieza: ${error.message}`);
        console.error(`Stack trace: ${error.stack}`);

        // En caso de error, usar un método simple: programar para la próxima vez que sea la hora configurada
        const fallbackTime = new Date();
        fallbackTime.setHours(CLEANUP_HOUR, CLEANUP_MINUTE, 0, 0);
        const now = new Date();
        if (fallbackTime <= now) {
            fallbackTime.setDate(fallbackTime.getDate() + 1);
        }
        console.log(`⚠️ Usando tiempo fallback: ${fallbackTime.toISOString()}`);
        return fallbackTime;
    }
};

// Función para programar la próxima limpieza a una hora específica
const scheduleNextCleanup = (
    sessionId,
    storeInstance,
    storePath,
    pinoLogger,
) => {
    // Cancelar cualquier timer existente
    if (scheduledCleanupTimers.has(sessionId)) {
        clearTimeout(scheduledCleanupTimers.get(sessionId));
        scheduledCleanupTimers.delete(sessionId);
    }

    const nextCleanupTime = getNextScheduledCleanupTime();
    const msUntilNextCleanup = nextCleanupTime.getTime() - new Date().getTime();

    // Formatear la hora de la próxima limpieza en la zona horaria del usuario
    const formattedNextCleanupTime = formatTimeInUserTimezone(nextCleanupTime);

    console.log(
        `[${sessionId}] ⏰ Próxima limpieza programada: ${nextCleanupTime.toISOString()} (${formattedNextCleanupTime}) en ${Math.round(msUntilNextCleanup / 60000)} minutos`,
    );

    // Programar la próxima limpieza
    const timer = setTimeout(async () => {
        const now = new Date();
        const executionTimeUTC = now.toISOString();
        const executionTimeLocal = formatTimeInUserTimezone(now);

        console.log(
            `[${sessionId}] ⏰ Ejecutando limpieza programada a las ${executionTimeUTC} (${executionTimeLocal})`,
        );
        await performMessageStoreCleanup(
            sessionId,
            storeInstance,
            storePath,
            pinoLogger,
        );
        // Programar la siguiente limpieza
        scheduleNextCleanup(sessionId, storeInstance, storePath, pinoLogger);
    }, msUntilNextCleanup);

    // Asegurar que el temporizador no impida que Node.js se cierre correctamente
    if (timer.unref) timer.unref();

    scheduledCleanupTimers.set(sessionId, timer);
};

// Configurar la limpieza del historial (hora programada y respaldo por intervalo)
const setupMessageStoreCleanup = async (
    sessionId,
    storeInstance,
    storePath,
    pinoLogger,
) => {
    // Cargar el tiempo de la última limpieza desde el almacenamiento persistente
    const persistedLastCleanup = await loadLastCleanupTime(sessionId);
    if (persistedLastCleanup) {
        lastCleanupTime.set(sessionId, persistedLastCleanup);
        pinoLogger.info(
            `[${sessionId}] Loaded last cleanup time from storage: ${persistedLastCleanup.toLocaleString()}`,
        );
    }

    // Verificar si se necesita una limpieza inmediata después del reinicio
    const shouldCleanNow = shouldPerformImmediateCleanup(persistedLastCleanup);
    if (shouldCleanNow) {
        pinoLogger.info(
            `[${sessionId}] Detected missed cleanup after restart. Performing immediate cleanup...`,
        );
        await performMessageStoreCleanup(
            sessionId,
            storeInstance,
            storePath,
            pinoLogger,
        );
    }

    // 1. Programar limpieza a una hora específica del día
    scheduleNextCleanup(sessionId, storeInstance, storePath, pinoLogger);

    // 2. Configurar intervalo de respaldo (solo si está habilitado)
    if (CLEANUP_INTERVAL_HOURS > 0) {
        // Cancelar cualquier timer de intervalo existente
        if (intervalCleanupTimers.has(sessionId)) {
            clearInterval(intervalCleanupTimers.get(sessionId));
            intervalCleanupTimers.delete(sessionId);
        }

        const intervalMs = CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000;

        pinoLogger.info(
            `[${sessionId}] Backup interval cleanup configured every ${CLEANUP_INTERVAL_HOURS} hours.`,
        );

        // Crear un nuevo timer de intervalo
        const timer = setInterval(async () => {
            // Verificar cuándo fue la última limpieza
            const lastCleanup = lastCleanupTime.get(sessionId);
            const hoursSinceLastCleanup = lastCleanup
                ? (new Date().getTime() - lastCleanup.getTime()) /
                  (60 * 60 * 1000)
                : CLEANUP_INTERVAL_HOURS + 1; // Si no hay última limpieza, forzar una limpieza

            // Solo limpiar si ha pasado suficiente tiempo desde la última limpieza
            if (hoursSinceLastCleanup >= CLEANUP_INTERVAL_HOURS) {
                pinoLogger.info(
                    `[${sessionId}] Running interval-based backup cleanup...`,
                );
                await performMessageStoreCleanup(
                    sessionId,
                    storeInstance,
                    storePath,
                    pinoLogger,
                );
            } else {
                pinoLogger.info(
                    `[${sessionId}] Skipping interval cleanup as last cleanup was ${hoursSinceLastCleanup.toFixed(2)} hours ago.`,
                );
            }
        }, intervalMs);

        // Asegurar que el temporizador no impida que Node.js se cierre correctamente
        if (timer.unref) timer.unref();

        intervalCleanupTimers.set(sessionId, timer);
    } else {
        pinoLogger.info(
            `[${sessionId}] Interval-based backup cleanup is disabled.`,
        );
    }
};

// Función para verificar el uso de memoria y forzar la limpieza si es necesario
const checkMemoryUsage = (sessionId, storeInstance, storePath, pinoLogger) => {
    const memoryUsage = process.memoryUsage();
    // Si el uso de la memoria heap supera el 95% del límite, forzar limpieza crítica
    const heapUsedPercentage =
        (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

    if (heapUsedPercentage > 98) {
        console.log(
            `[${sessionId}] 🚨 USO CRÍTICO DE MEMORIA DETECTADO (${heapUsedPercentage.toFixed(2)}% de heap). Forzando limpieza crítica...`,
        );

        // Forzar limpieza crítica incluso si hace poco que se limpió
        performMessageStoreCleanup(
            sessionId,
            storeInstance,
            storePath,
            pinoLogger,
            true,
        );

        // Sugerir ejecutar el recolector de basura
        if (global.gc) {
            console.log(
                `[${sessionId}] 🧹 Ejecutando recolector de basura después de limpieza crítica`,
            );
            global.gc();
        }
    }
    // Solo reportar alto uso de memoria entre 90-97% pero no forzar limpieza
    else if (heapUsedPercentage > 95) {
        console.log(
            `[${sessionId}] ⚠️ Alto uso de memoria detectado (${heapUsedPercentage.toFixed(2)}% de heap), monitorizando...`,
        );

        // No forzar limpieza, solo monitorizar
        if (global.gc) {
            console.log(
                `[${sessionId}] 🧹 Ejecutando recolector de basura preventivo`,
            );
            global.gc();
        }
    }
};

const createSession = async (
    sessionId,
    res = null,
    options = { usePairingCode: false, phoneNumber: "" },
) => {
    console.log(`[${sessionId}] 📱 Creando/recuperando sesión...`);

    // Verificar si la sesión ya existe para evitar duplicados
    if (sessions.has(sessionId)) {
        const existingSession = sessions.get(sessionId);
        if (existingSession.ws?.socket?.readyState === 1) {
            console.log(
                `[${sessionId}] ⚠️ La sesión ya existe y está conectada. Omitiendo creación.`,
            );
            if (res && !res.headersSent) {
                response(
                    res,
                    200,
                    true,
                    "Session already exists and connected.",
                );
            }
            return;
        } else {
            console.log(
                `[${sessionId}] La sesión existe pero no está conectada. Reemplazando.`,
            );
        }
    }

    const sessionAuthDir = "md_" + sessionId;
    if (!existsSync(sessionsDir()))
        mkdirSync(sessionsDir(), { recursive: true });
    if (!existsSync(sessionsDir(sessionAuthDir)))
        mkdirSync(sessionsDir(sessionAuthDir), { recursive: true });

    const pinoLogger = pino({ level: "silent" }); // 'silent' o 'debug' para logs de Baileys

    const store = makeInMemoryStore({
        logger: pinoLogger,
        // Limitar el número máximo de mensajes almacenados para evitar problemas de memoria
        maxCachedMessages: 500,
    });

    const { state, saveCreds } = await useMultiFileAuthState(
        sessionsDir(sessionAuthDir),
    );
    const { version, isLatest } = await fetchLatestBaileysVersion();
    pinoLogger.info(
        `[${sessionId}] using WA v${version.join(".")}, isLatest: ${isLatest}`,
    );

    const storeFilePath = getStorePath(sessionId);
    if (existsSync(storeFilePath)) {
        try {
            store?.readFromFile(storeFilePath);
        } catch (error) {
            // Si hay un error al leer el archivo (posiblemente corrupto), eliminarlo y crear uno nuevo
            pinoLogger.error(
                `[${sessionId}] Error reading store file, creating a new one: ${error.message}`,
            );
            if (existsSync(storeFilePath)) {
                rmSync(storeFilePath, { force: true });
            }
        }
    }

    // Configurar intervalo de guardado
    const saveInterval = setInterval(() => {
        try {
            // Verificar uso de memoria antes de guardar
            const memoryUsage = process.memoryUsage();
            const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);

            if (store && existsSync(sessionsDir(sessionAuthDir))) {
                store?.writeToFile(storeFilePath);
                pinoLogger.debug(
                    `[${sessionId}] Store saved to ${storeFilePath} (Mem: ${heapUsedMB}MB)`,
                );
            }

            // La verificación de memoria se hace ahora cada 12 horas en un intervalo separado
        } catch (error) {
            pinoLogger.error(
                `[${sessionId}] Error saving store: ${error.message}`,
            );
        }
    }, 30000); // 30 segundos para guardar el store

    // Configurar intervalo de verificación de memoria (cada 12 horas)
    console.log(
        `[${sessionId}] 🕐 Configurando verificación de memoria cada 12 horas`,
    );
    const memoryCheckInterval = setInterval(
        () => {
            try {
                console.log(
                    `[${sessionId}] 🔍 Ejecutando verificación de memoria programada (cada 12 horas)`,
                );
                checkMemoryUsage(sessionId, store, storeFilePath, pinoLogger);
            } catch (error) {
                pinoLogger.error(
                    `[${sessionId}] Error during memory check: ${error.message}`,
                );
            }
        },
        12 * 60 * 60 * 1000,
    ); // 12 horas en milisegundos

    // Asegurar que el timer no impida que Node.js se cierre correctamente
    if (memoryCheckInterval.unref) memoryCheckInterval.unref();

    // Almacenar el timer para limpieza posterior
    memoryCheckTimers.set(sessionId, memoryCheckInterval);

    // Ejecutar verificación inicial de memoria
    console.log(`[${sessionId}] 🔍 Ejecutando verificación inicial de memoria`);
    setTimeout(() => {
        try {
            checkMemoryUsage(sessionId, store, storeFilePath, pinoLogger);
        } catch (error) {
            pinoLogger.error(
                `[${sessionId}] Error during initial memory check: ${error.message}`,
            );
        }
    }, 5000); // Verificar en 5 segundos después de crear la sesión

    const makeWASocket = makeWASocketModule.default ?? makeWASocketModule;
    const WA_VERSION = [2, 3000, 1025190524];
    const wa = makeWASocket({
        //version: WA_VERSION,
        printQRInTerminal: false,
        mobile: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pinoLogger),
        },
        logger: pinoLogger,
        msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        getMessage,
        // Reducir el historial sincronizado para ahorrar memoria
        syncFullHistory: true, // 🔧 CAMBIO TEMPORAL: Activando sincronización completa para diagnóstico
        // Opciones para mejorar el rendimiento de memoria
        keepAliveIntervalMs: 30000, // Aumentar para reducir la carga
        // Desactivar funciones menos usadas para ahorrar memoria
        transactionOpts: { maxCommitRetries: 3, delayBetweenTriesMs: 500 },
    });

    store?.bind(wa.ev);
    sessions.set(sessionId, { ...wa, store, saveInterval });

    // Configurar limpieza del historial (hora programada + intervalo de respaldo)
    await setupMessageStoreCleanup(sessionId, store, storeFilePath, pinoLogger);

    if (options.usePairingCode && !wa.authState.creds.registered) {
        if (!wa.authState.creds.account) {
            await wa.waitForConnectionUpdate((update) => Boolean(update.qr));
            const code = await wa.requestPairingCode(options.phoneNumber);
            if (res && !res.headersSent && code !== undefined) {
                response(
                    res,
                    200,
                    true,
                    "Verify on your phone and enter the provided code.",
                    { code },
                );
            } else {
                if (res && !res.headersSent)
                    response(
                        res,
                        500,
                        false,
                        "Unable to create session or get pairing code.",
                    );
            }
        }
    }

    wa.ev.on("creds.update", saveCreds);

    wa.ev.on("chats.set", ({ chats }) => {
        callWebhook(sessionId, "CHATS_SET", chats);
    });
    wa.ev.on("chats.upsert", (c) => callWebhook(sessionId, "CHATS_UPSERT", c));
    wa.ev.on("chats.delete", (c) => callWebhook(sessionId, "CHATS_DELETE", c));
    wa.ev.on("chats.update", (c) => callWebhook(sessionId, "CHATS_UPDATE", c));
    wa.ev.on("labels.association", (l) =>
        callWebhook(sessionId, "LABELS_ASSOCIATION", l),
    );
    wa.ev.on("labels.edit", (l) => callWebhook(sessionId, "LABELS_EDIT", l));

    // 🔄 Manejo del evento lid-mapping.update para capturar nuevos mappings LID/PN
    wa.ev.on("lid-mapping.update", (mappings) => {
        console.log(`[${sessionId}] 🔗 lid-mapping.update - Nuevos mappings recibidos:`, {
            count: mappings.length,
            mappings: mappings.map(m => ({
                lid: m.lid,
                pn: m.pn
            }))
        });

        try {
            // Almacenar cada mapping usando storeLIDPNMapping
            mappings.forEach(mapping => {
                if (mapping.lid && mapping.pn) {
                    wa.storeLIDPNMapping(mapping.lid, mapping.pn);
                    console.log(`[${sessionId}] ✅ Mapping almacenado: ${mapping.lid} <-> ${mapping.pn}`);
                }
            });
        } catch (error) {
            console.error(`[${sessionId}] ❌ Error almacenando mappings LID/PN:`, error);
        }
    });

    wa.ev.on("messages.upsert", async (m) => {
        // 🔍 LOG: Mensajes recibidos en messages.upsert
        console.log(`[${sessionId}] 📨 messages.upsert - Mensajes recibidos:`, {
            totalMessages: m.messages.length,
            messagesInfo: m.messages.map(msg => ({
                id: msg.key?.id,
                fromMe: msg.key?.fromMe,
                remoteJid: msg.key?.remoteJid,
                participant: msg.key?.participant,
                timestamp: msg.messageTimestamp,
                hasMessage: !!msg.message,
                messageType: msg.message ? Object.keys(msg.message)[0] : null
            }))
        });

        // Análisis de fromMe en mensajes recibidos
        const fromMeStatsReceived = m.messages.reduce((stats, msg) => {
            const fromMe = msg.key?.fromMe;
            if (fromMe === true) stats.fromMeTrue++;
            else if (fromMe === false) stats.fromMeFalse++;
            else stats.fromMeUndefined++;
            return stats;
        }, { fromMeTrue: 0, fromMeFalse: 0, fromMeUndefined: 0 });

        console.log(`[${sessionId}] 📊 messages.upsert - Estadísticas fromMe recibidas:`, fromMeStatsReceived);

        // 🔗 Extraer y almacenar mappings LID/PN de remoteJidAlt
        m.messages.forEach(msg => {
            try {
                const { remoteJid, remoteJidAlt } = msg.key || {};
                
                if (remoteJid && remoteJidAlt && remoteJid !== remoteJidAlt) {
                    // Extraer el número de teléfono de remoteJidAlt (formato: numero@s.whatsapp.net)
                    const pnMatch = remoteJidAlt.match(/^(\d+)@s\.whatsapp\.net$/);
                    
                    if (pnMatch) {
                        const phoneNumber = pnMatch[1];
                        console.log(`[${sessionId}] 🔗 Mapping LID/PN detectado en mensaje:`, {
                            messageId: msg.key.id,
                            lid: remoteJid,
                            pn: phoneNumber,
                            remoteJidAlt: remoteJidAlt
                        });

                        // Almacenar el mapping usando storeLIDPNMapping
                        if (wa.storeLIDPNMapping) {
                            wa.storeLIDPNMapping(remoteJid, phoneNumber);
                            console.log(`[${sessionId}] ✅ Mapping almacenado desde mensaje: ${remoteJid} <-> ${phoneNumber}`);
                        } else {
                            console.warn(`[${sessionId}] ⚠️ storeLIDPNMapping no disponible`);
                        }
                    }
                }
            } catch (error) {
                console.error(`[${sessionId}] ❌ Error procesando mapping LID/PN del mensaje:`, error);
            }
        });

        // Filtrar para procesar solo mensajes no enviados por nosotros
        const messagesToProcess = m.messages.filter((msg) => !msg.key.fromMe);
        
        console.log(`[${sessionId}] 🔄 messages.upsert - Después del filtro (!fromMe):`, {
            originalCount: m.messages.length,
            filteredCount: messagesToProcess.length,
            filteredOut: m.messages.length - messagesToProcess.length
        });

        if (messagesToProcess.length > 0) {
            const processedMessagesForWebhook = await Promise.all(
                messagesToProcess.map(async (msg) => {
                    try {
                        if (!msg.message || typeof msg.message !== "object") {
                            pinoLogger.warn(
                                `[${sessionId}][messages.upsert] Msg (key: ${msg.key?.id}) has null/non-object message content.`,
                            );
                            return msg;
                        }
                        const typeMessage = Object.keys(msg.message)[0];
                        if (msg?.status)
                            msg.status =
                                WAMessageStatus[msg.status] ??
                                msg.status.toString();

                        // Solo procesar mensajes multimedia si está habilitado
                        if (
                            [
                                "documentMessage",
                                "imageMessage",
                                "videoMessage",
                                "audioMessage",
                            ].includes(typeMessage) &&
                            process.env.APP_WEBHOOK_FILE_IN_BASE64 === "true"
                        ) {
                            if (msg.message[typeMessage]) {
                                try {
                                    const mediaMessage = await getMessageMedia(
                                        wa,
                                        msg,
                                    );
                                    if (mediaMessage && mediaMessage.base64) {
                                        const fieldsToConvert = [
                                            "fileEncSha256",
                                            "mediaKey",
                                            "fileSha256",
                                            "jpegThumbnail",
                                            "thumbnailSha256",
                                            "thumbnailEncSha256",
                                            "streamingSidecar",
                                        ];
                                        fieldsToConvert.forEach((field) => {
                                            if (
                                                msg.message[typeMessage]?.[
                                                    field
                                                ]
                                            )
                                                msg.message[typeMessage][
                                                    field
                                                ] = convertToBase64(
                                                    msg.message[typeMessage][
                                                        field
                                                    ],
                                                );
                                        });
                                        return {
                                            ...msg,
                                            message: {
                                                [typeMessage]: {
                                                    ...msg.message[typeMessage],
                                                    fileBase64:
                                                        mediaMessage.base64,
                                                },
                                            },
                                        };
                                    }
                                } catch (mediaError) {
                                    pinoLogger.error(
                                        `[${sessionId}] Error processing media: ${mediaError.message}`,
                                    );
                                    // Devolver el mensaje sin el contenido multimedia en caso de error
                                    return msg;
                                }
                            }
                        }
                        return msg;
                    } catch (e) {
                        pinoLogger.error(
                            { err: e, msgKey: msg?.key },
                            `[${sessionId}][messages.upsert] Error processing message for webhook (map fn)`,
                        );
                        return {};
                    }
                }),
            );
            const validProcessedMessages = processedMessagesForWebhook.filter(
                (item) => item && Object.keys(item).length > 0,
            );
            if (validProcessedMessages.length > 0)
                callWebhook(
                    sessionId,
                    "MESSAGES_UPSERT",
                    validProcessedMessages,
                );
        }
    });
    wa.ev.on("messages.delete", (m) =>
        callWebhook(sessionId, "MESSAGES_DELETE", m),
    );
    wa.ev.on("messages.update", async (messageUpdates) => {
        for (const { key, update } of messageUpdates) {
            const msg = await getMessage(key);
            if (!msg) continue;
            if (update?.status)
                update.status =
                    WAMessageStatus[update.status] ?? update.status.toString();
            callWebhook(sessionId, "MESSAGES_UPDATE", [
                { key, update, message: msg },
            ]);
        }
    });
    wa.ev.on("message-receipt.update", async (receiptUpdates) => {
        const updatesToSend = [];
        for (const item of receiptUpdates) {
            const { key, update } = item;
            if (update?.pollUpdates) {
                const pollCreation = await getMessage(key);
                if (pollCreation) {
                    const pollMessage = await getAggregateVotesInPollMessage({
                        message: pollCreation,
                        pollUpdates: update.pollUpdates,
                    });
                    if (update.pollUpdates[0])
                        update.pollUpdates[0].vote = pollMessage;
                }
            }
            updatesToSend.push(item);
        }
        if (updatesToSend.length > 0)
            callWebhook(sessionId, "MESSAGES_RECEIPT_UPDATE", updatesToSend);
    });
    wa.ev.on("messages.reaction", (m) =>
        callWebhook(sessionId, "MESSAGES_REACTION", m),
    );
    wa.ev.on("messages.media-update", (m) =>
        callWebhook(sessionId, "MESSAGES_MEDIA_UPDATE", m),
    );
    wa.ev.on("messaging-history.set", (m) =>
        callWebhook(sessionId, "MESSAGING_HISTORY_SET", m),
    );
    wa.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        callWebhook(sessionId, "CONNECTION_UPDATE", update);

        if (connection === "open") {
            retries.delete(sessionId);
            pinoLogger.info(
                `[${sessionId}] Connection open. Store chats: ${store?.chats?.size || 0}`,
            );

            // Al conectarse correctamente, cargar pero NO realizar limpieza automática
            // para evitar limpiezas excesivas durante reconexiones
            try {
                if (!lastCleanupTime.has(sessionId)) {
                    const persistedLastCleanup =
                        await loadLastCleanupTime(sessionId);
                    if (persistedLastCleanup) {
                        lastCleanupTime.set(sessionId, persistedLastCleanup);
                        pinoLogger.info(
                            `[${sessionId}] Loaded last cleanup time on connection: ${persistedLastCleanup.toLocaleString()}`,
                        );
                    }
                }

                // Solo programar las próximas limpiezas, sin forzar una limpieza inmediata
                // durante la reconexión para evitar múltiples limpiezas

                // Verificar si hay timers de limpieza programados y configurarlos si no existen
                if (!scheduledCleanupTimers.has(sessionId)) {
                    scheduleNextCleanup(
                        sessionId,
                        store,
                        storeFilePath,
                        pinoLogger,
                    );
                }

                if (
                    CLEANUP_INTERVAL_HOURS > 0 &&
                    !intervalCleanupTimers.has(sessionId)
                ) {
                    const intervalMs = CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000;

                    const timer = setInterval(async () => {
                        const lastCleanup = lastCleanupTime.get(sessionId);
                        const hoursSinceLastCleanup = lastCleanup
                            ? (new Date().getTime() - lastCleanup.getTime()) /
                              (60 * 60 * 1000)
                            : CLEANUP_INTERVAL_HOURS + 1;

                        if (hoursSinceLastCleanup >= CLEANUP_INTERVAL_HOURS) {
                            console.log(
                                `[${sessionId}] 🔄 Ejecutando limpieza por intervalo...`,
                            );
                            await performMessageStoreCleanup(
                                sessionId,
                                store,
                                storeFilePath,
                                pinoLogger,
                            );
                        }
                    }, intervalMs);

                    if (timer.unref) timer.unref();
                    intervalCleanupTimers.set(sessionId, timer);
                }
            } catch (error) {
                pinoLogger.error(
                    `[${sessionId}] Error setting up cleanup on connection: ${error.message}`,
                );
            }
        }

        if (connection === "close") {
            // Determinar si debemos intentar reconectar
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            const maxRetriesReached = !shouldReconnect(sessionId);

            if (isLoggedOut) {
                pinoLogger.info(
                    `[${sessionId}] Connection closed (logged out). Deleting session.`,
                );
                if (res && !res.headersSent) {
                    response(
                        res,
                        500,
                        false,
                        "Unable to create session. Logged out.",
                    );
                }
                // No es necesario llamar a deleteSession aquí, ya que shouldReconnect lo hace cuando se alcanzan los reintentos máximos
                return;
            }

            if (maxRetriesReached) {
                // No hacemos nada aquí, ya que shouldReconnect() ya habría llamado a deleteSession()
                if (res && !res.headersSent) {
                    response(
                        res,
                        500,
                        false,
                        "Unable to create session. Max retries reached.",
                    );
                }
                return;
            }

            // Calcular retraso para reconexión
            const reconnectDelay =
                statusCode === DisconnectReason.restartRequired
                    ? 0
                    : getReconnectDelay(sessionId);

            pinoLogger.info(
                `[${sessionId}] Connection closed. Reconnecting in ${reconnectDelay / 1000}s...`,
            );

            setTimeout(() => createSession(sessionId, res), reconnectDelay);
        }

        if (qr) {
            if (res && !res.headersSent) {
                callWebhook(sessionId, "QRCODE_UPDATED", update);
                try {
                    const qrcode = await toDataURL(qr);
                    response(
                        res,
                        200,
                        true,
                        "QR code received, please scan the QR code.",
                        { qrcode },
                    );
                } catch (error) {
                    if (res && !res.headersSent)
                        response(res, 500, false, "Unable to create QR code.");
                }
            } else if (!res) {
                try {
                    await wa.logout("New QR on auto-reconnect");
                } catch (e) {
                    pinoLogger.error(
                        e,
                        `Error logout on new QR for ${sessionId}`,
                    );
                } finally {
                    deleteSession(sessionId);
                }
            }
        }
    });
    wa.ev.on("groups.upsert", (m) =>
        callWebhook(sessionId, "GROUPS_UPSERT", m),
    );
    wa.ev.on("groups.update", (m) =>
        callWebhook(sessionId, "GROUPS_UPDATE", m),
    );
    wa.ev.on("group-participants.update", (m) =>
        callWebhook(sessionId, "GROUP_PARTICIPANTS_UPDATE", m),
    );
    wa.ev.on("blocklist.set", (m) =>
        callWebhook(sessionId, "BLOCKLIST_SET", m),
    );
    wa.ev.on("blocklist.update", (m) =>
        callWebhook(sessionId, "BLOCKLIST_UPDATE", m),
    );
    wa.ev.on("contacts.set", (c) => callWebhook(sessionId, "CONTACTS_SET", c));
    wa.ev.on("contacts.upsert", (c) =>
        callWebhook(sessionId, "CONTACTS_UPSERT", c),
    );
    wa.ev.on("contacts.update", (c) =>
        callWebhook(sessionId, "CONTACTS_UPDATE", c),
    );
    wa.ev.on("presence.update", (p) =>
        callWebhook(sessionId, "PRESENCE_UPDATE", p),
    );

    async function getMessage(key) {
        if (store?.loadMessage) {
            try {
                const msgObject = await store.loadMessage(
                    key.remoteJid,
                    key.id,
                );
                return msgObject?.message;
            } catch (error) {
                pinoLogger.error(
                    `[${sessionId}] Error loading message: ${error.message}`,
                );
                return proto.Message.fromObject({});
            }
        }
        return proto.Message.fromObject({});
    }
};

const getSession = (sessionId) => sessions.get(sessionId) ?? null;
const getListSessions = () => [...sessions.keys()];

const deleteSession = (sessionId) => {
    console.log(
        `[${sessionId}] Executing complete session deletion and cleanup...`,
    );

    try {
        const sessionData = sessions.get(sessionId);

        // Intentar hacer logout si es posible (pero no esperar por ello)
        if (sessionData?.ws?.logout) {
            try {
                sessionData.ws
                    .logout("Session deleted by max retries or manual request")
                    .catch((err) =>
                        console.error(
                            `[${sessionId}] Error during logout: ${err.message}`,
                        ),
                    );
            } catch (error) {
                console.error(
                    `[${sessionId}] Error initiating logout: ${error.message}`,
                );
            }
        }

        // Limpiar timers de guardado
        if (sessionData?.saveInterval) {
            clearInterval(sessionData.saveInterval);
            console.log(`[${sessionId}] Cleared save interval timer`);
        }

        // Limpiar timers de limpieza programada
        if (scheduledCleanupTimers.has(sessionId)) {
            clearTimeout(scheduledCleanupTimers.get(sessionId));
            scheduledCleanupTimers.delete(sessionId);
            console.log(`[${sessionId}] Cleared scheduled cleanup timer`);
        }

        // Limpiar timers de limpieza por intervalo
        if (intervalCleanupTimers.has(sessionId)) {
            clearInterval(intervalCleanupTimers.get(sessionId));
            intervalCleanupTimers.delete(sessionId);
            console.log(`[${sessionId}] Cleared interval cleanup timer`);
        }

        // Limpiar timers de verificación de memoria
        if (memoryCheckTimers.has(sessionId)) {
            clearInterval(memoryCheckTimers.get(sessionId));
            memoryCheckTimers.delete(sessionId);
            console.log(`[${sessionId}] Cleared memory check timer`);
        }

        // Eliminar registro de última limpieza
        lastCleanupTime.delete(sessionId);

        // Eliminar archivos de sesión
        const sessionAuthDir = "md_" + sessionId;
        const storeFilePath = getStorePath(sessionId);
        const lastCleanupFilePath = getLastCleanupFilePath(sessionId);
        const rmOptions = { force: true, recursive: true };

        // Eliminar directorio de autenticación
        if (existsSync(sessionsDir(sessionAuthDir))) {
            rmSync(sessionsDir(sessionAuthDir), rmOptions);
            console.log(
                `[${sessionId}] Removed auth directory: ${sessionsDir(sessionAuthDir)}`,
            );
        } else {
            console.log(
                `[${sessionId}] Auth directory does not exist: ${sessionsDir(sessionAuthDir)}`,
            );
        }

        // Eliminar archivo de store
        if (existsSync(storeFilePath)) {
            rmSync(storeFilePath, { force: true });
            console.log(`[${sessionId}] Removed store file: ${storeFilePath}`);
        } else {
            console.log(
                `[${sessionId}] Store file does not exist: ${storeFilePath}`,
            );
        }

        // Eliminar archivo de registro de limpieza
        if (existsSync(lastCleanupFilePath)) {
            rmSync(lastCleanupFilePath, { force: true });
            console.log(
                `[${sessionId}] Removed cleanup record file: ${lastCleanupFilePath}`,
            );
        } else {
            console.log(
                `[${sessionId}] Cleanup record file does not exist: ${lastCleanupFilePath}`,
            );
        }

        // Buscar y eliminar cualquier otro archivo relacionado con esta sesión
        try {
            const files = readdirSync(sessionsDir());
            const relatedFiles = files.filter((file) =>
                file.includes(sessionId),
            );

            for (const file of relatedFiles) {
                const filePath = join(sessionsDir(), file);
                rmSync(filePath, { force: true });
                console.log(`[${sessionId}] Removed related file: ${filePath}`);
            }
        } catch (error) {
            console.error(
                `[${sessionId}] Error searching for related files: ${error.message}`,
            );
        }

        // Eliminar la sesión y contadores de reintentos
        sessions.delete(sessionId);
        retries.delete(sessionId);

        console.log(
            `[${sessionId}] Session completely deleted and cleaned up.`,
        );
    } catch (error) {
        console.error(
            `[${sessionId}] Error during session deletion: ${error.message}`,
        );

        // Intento final de eliminar la sesión incluso si hubo errores
        sessions.delete(sessionId);
        retries.delete(sessionId);
    }
};

const getChatList = (sessionId, isGroup = false) => {
    const sessionData = getSession(sessionId);
    if (
        !sessionData?.store?.chats ||
        !(sessionData.store.chats instanceof Map)
    ) {
        return [];
    }
    const filterSuffix = isGroup ? "@g.us" : "@s.whatsapp.net";
    return Array.from(sessionData.store.chats.values()).filter((chat) =>
        chat.id?.endsWith(filterSuffix),
    );
};

const isExists = async (session, jid, isGroup = false) => {
    try {
        let r;
        if (isGroup) {
            r = await session.groupMetadata(jid);
            return Boolean(r.id);
        }
        [r] = await session.onWhatsApp(jid);
        return r.exists;
    } catch {
        return !1;
    }
};

const sendMessage = async (
    session,
    receiver,
    messageContent,
    options = {},
    delayMs = 1000,
) => {
    try {
        await delay(parseInt(delayMs));
        const result = await session.sendMessage(
            receiver,
            messageContent,
            options,
        );
        return result;
    } catch (e) {
        console.error(
            `[whatsapp.js sendMessage] BAILEYS ERROR sending to ${receiver}:`,
            e?.message || e,
        );
        return Promise.reject(e);
    }
};
const updateProfileStatus = async (session, status) => {
    try {
        return await session.updateProfileStatus(status);
    } catch {
        return Promise.reject(null);
    }
};
const updateProfileName = async (session, name) => {
    try {
        return await session.updateProfileName(name);
    } catch {
        return Promise.reject(null);
    }
};
const getProfilePicture = async (session, jid, type = "image") => {
    try {
        return await session.profilePictureUrl(jid, type);
    } catch {
        return Promise.reject(null);
    }
};
const blockAndUnblockUser = async (session, jid, block) => {
    try {
        return await session.updateBlockStatus(
            jid,
            block ? "block" : "unblock",
        );
    } catch {
        return Promise.reject(null);
    }
};
const formatPhone = (phone) => {
    if (phone.endsWith("@s.whatsapp.net")) return phone;
    let f = phone.replace(/\D/g, "");
    return (f += "@s.whatsapp.net");
};
const formatGroup = (group) => {
    if (group.endsWith("@g.us")) return group;
    let f = group.replace(/[^\d-]/g, "");
    return (f += "@g.us");
};

const cleanup = () => {
    console.log("Running cleanup before exit.");
    sessions.forEach((sessionObject, sessionId) => {
        // Limpiar timers de guardado
        if (sessionObject.saveInterval)
            clearInterval(sessionObject.saveInterval);

        // Limpiar timers de limpieza programada
        if (scheduledCleanupTimers.has(sessionId)) {
            clearTimeout(scheduledCleanupTimers.get(sessionId));
            scheduledCleanupTimers.delete(sessionId);
        }

        // Limpiar timers de limpieza por intervalo
        if (intervalCleanupTimers.has(sessionId)) {
            clearInterval(intervalCleanupTimers.get(sessionId));
            intervalCleanupTimers.delete(sessionId);
        }

        // Limpiar timers de verificación de memoria
        if (memoryCheckTimers.has(sessionId)) {
            clearInterval(memoryCheckTimers.get(sessionId));
            memoryCheckTimers.delete(sessionId);
        }

        // Guardar el store antes de salir
        if (sessionObject.store?.writeToFile) {
            const storeFilePath = getStorePath(sessionId);
            // Solo guardar si el archivo de store ya existe Y la sesión de auth existe
            if (
                existsSync(storeFilePath) &&
                existsSync(sessionsDir("md_" + sessionId))
            ) {
                // Intentar realizar una limpieza final antes de guardar
                if (
                    typeof sessionObject.store.clearAllMessages === "function"
                ) {
                    console.log(
                        `[${sessionId}] Performing final cleanup before exit`,
                    );
                    sessionObject.store.clearAllMessages();

                    // Guardar el tiempo de la última limpieza antes de salir
                    const now = new Date();
                    lastCleanupTime.set(sessionId, now);
                    saveLastCleanupTime(sessionId, now).catch((err) => {
                        console.error(
                            `[${sessionId}] Error saving final cleanup time: ${err.message}`,
                        );
                    });
                }

                sessionObject.store.writeToFile(storeFilePath);
                console.log(
                    `[${sessionId}] Store saved to ${storeFilePath} during cleanup.`,
                );
            } else if (existsSync(sessionsDir("md_" + sessionId))) {
                console.log(
                    `[${sessionId}] Store file ${storeFilePath} did not exist. Not saving during cleanup.`,
                );
            }
        }
    });

    // Sugerir ejecución del recolector de basura
    if (global.gc) {
        console.log("Running garbage collector before exit");
        global.gc();
    }
};

const getGroupsWithParticipants = async (session) =>
    session.groupFetchAllParticipating();
const participantsUpdate = async (session, jid, participants, action) =>
    session.groupParticipantsUpdate(jid, participants, action);
const updateSubject = async (session, jid, subject) =>
    session.groupUpdateSubject(jid, subject);
const updateDescription = async (session, jid, description) =>
    session.groupUpdateDescription(jid, description);
const settingUpdate = async (session, jid, settings) =>
    session.groupSettingUpdate(jid, settings);
const leave = async (session, jid) => session.groupLeave(jid);
const inviteCode = async (session, jid) => session.groupInviteCode(jid);
const revokeInvite = async (session, jid) => session.groupRevokeInvite(jid);
const metaData = async (session, req) => session.groupMetadata(req.groupId);
const acceptInvite = async (session, req) =>
    session.groupAcceptInvite(req.invite);
const profilePicture = async (session, jid, urlImage) => {
    const img = await downloadImage(urlImage);
    return session.updateProfilePicture(jid, { url: img });
};
const readMessage = async (session, keys) => session.readMessages(keys);
const getStoreMessage = async (session, messageId, remoteJid) => {
    try {
        if (session.store?.loadMessage)
            return await session.store.loadMessage(remoteJid, messageId);
        return Promise.reject("Store or loadMessage not found");
    } catch {
        return Promise.reject(null);
    }
};

const getMessageMedia = async (session, message) => {
    if (!message || !message.message) {
        console.error(
            "[getMessageMedia] Error: message or message.message is undefined",
            message,
        );
        return Promise.reject("Invalid message object for media download");
    }
    try {
        const type = Object.keys(message.message)[0];
        const media = message.message[type];
        if (!media) {
            console.error(
                `[getMessageMedia] Error: media content for type ${type} is undefined`,
            );
            return Promise.reject(`No media content found for type ${type}`);
        }
        const buff = await downloadMediaMessage(
            message,
            "buffer",
            {},
            { reuploadRequest: session.updateMediaMessage },
        );
        return {
            messageType: type,
            fileName: media.fileName ?? "",
            caption: media.caption ?? "",
            size: {
                fileLength: media.fileLength,
                height: media.height ?? 0,
                width: media.width ?? 0,
            },
            mimetype: media.mimetype,
            base64: buff.toString("base64"),
        };
    } catch (e) {
        console.error("[getMessageMedia] Error downloading media:", e);
        return Promise.reject(null);
    }
};

const convertToBase64 = (arrayBytes) => {
    if (!arrayBytes || !arrayBytes.length) return "";
    try {
        const byteArray = new Uint8Array(arrayBytes);
        return Buffer.from(byteArray).toString("base64");
    } catch (error) {
        console.error("[convertToBase64] Error converting to base64:", error);
        return "";
    }
};

const init = async () => {
    console.log("[INIT] Starting application and session recovery...");
    if (!existsSync(sessionsDir())) {
        console.log("[INIT] Base sessions directory does not exist. Creating.");
        mkdirSync(sessionsDir(), { recursive: true });
    }

    let dirents;
    try {
        dirents = await fsPromises.readdir(sessionsDir(), {
            withFileTypes: true,
        });
    } catch (err) {
        if (err.code === "ENOENT") {
            console.log(
                "[INIT] Sessions directory does not exist for init scan. No sessions to recover.",
            );
            return;
        }
        console.error("[INIT] Error reading sessions directory:", err);
        return;
    }

    const sessionIdsToRecover = dirents
        .filter(
            (dirent) => dirent.isDirectory() && dirent.name.startsWith("md_"),
        )
        .map((dirent) => dirent.name.substring(3));

    if (sessionIdsToRecover.length === 0) {
        console.log("[INIT] No existing sessions found to recover.");
        return;
    }

    console.log(
        `[INIT] Found ${sessionIdsToRecover.length} potential sessions to recover:`,
        sessionIdsToRecover.join(", "),
    );
    console.log(
        `[INIT] Starting sessions sequentially with a ${SESSION_INIT_DELAY / 1000}s delay between each attempt.`,
    );

    // Usar un bucle for...of para poder usar await con el delay
    for (const sessionId of sessionIdsToRecover) {
        if (isSessionExists(sessionId)) {
            console.log(
                `[INIT] Session ${sessionId} instance already exists in 'sessions' Map. Checking connection...`,
            );
            if (isSessionConnected(sessionId)) {
                console.log(
                    `[INIT] Session ${sessionId} is already connected. Skipping explicit recovery.`,
                );
                continue;
            } else {
                console.log(
                    `[INIT] Session ${sessionId} instance exists but not connected. Will proceed with createSession attempt.`,
                );
            }
        }

        console.log(`[INIT] Attempting to start/recover session: ${sessionId}`);

        createSession(sessionId, null)
            .then(() => {
                console.log(
                    `[INIT] createSession called for ${sessionId}. It will attempt to connect/reconnect.`,
                );
            })
            .catch((error) => {
                console.error(
                    `[INIT] Critical error during initial setup or unrecoverable failure for session ${sessionId}:`,
                    error?.message || error,
                );
            });

        // Esperar antes de intentar la siguiente sesión, solo si hay más en la cola
        if (
            sessionIdsToRecover.indexOf(sessionId) <
            sessionIdsToRecover.length - 1
        ) {
            console.log(
                `[INIT] Waiting ${SESSION_INIT_DELAY / 1000}s before attempting to recover next session...`,
            );
            await delay(SESSION_INIT_DELAY);
        }
    }
    console.log(
        "[INIT] Finished queueing all found sessions for recovery attempts.",
    );
};

export {
    isSessionExists,
    createSession,
    getSession,
    getListSessions,
    deleteSession,
    getChatList,
    getGroupsWithParticipants,
    isExists,
    sendMessage,
    updateProfileStatus,
    updateProfileName,
    getProfilePicture,
    formatPhone,
    formatGroup,
    cleanup,
    participantsUpdate,
    updateSubject,
    updateDescription,
    settingUpdate,
    leave,
    inviteCode,
    revokeInvite,
    metaData,
    acceptInvite,
    profilePicture,
    readMessage,
    init,
    isSessionConnected,
    getMessageMedia,
    getStoreMessage,
    blockAndUnblockUser,
};
