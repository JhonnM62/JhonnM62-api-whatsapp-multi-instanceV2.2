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
 * Convierte un JID entre formatos @lid y @s.whatsapp.net
 * @param {string} jid - JID a convertir
 * @returns {string} JID convertido al formato alternativo
 */
const convertJidFormat = (jid) => {
    if (!jid) return jid;
    
    // Si es formato @lid, convertir a @s.whatsapp.net
    if (jid.includes('@lid')) {
        const number = jid.split('@')[0];
        return `${number}@s.whatsapp.net`;
    }
    
    // Si es formato @s.whatsapp.net, convertir a @lid
    if (jid.includes('@s.whatsapp.net')) {
        const number = jid.split('@')[0];
        return `${number}@lid`;
    }
    
    // Si es formato @g.us (grupos), no convertir
    if (jid.includes('@g.us')) {
        return jid;
    }
    
    return jid;
}

/**
 * Obtiene ambos formatos posibles de un JID
 * @param {string} jid - JID original
 * @returns {Array<string>} Array con ambos formatos posibles
 */
const getJidFormats = (jid) => {
    if (!jid) return [jid];
    
    const formats = [jid];
    const converted = convertJidFormat(jid);
    
    if (converted !== jid) {
        formats.push(converted);
    }
    
    return formats;
}

export { compareAndFilter, isUrlValid, fileExists, deleteFile, convertJidFormat, getJidFormats }
