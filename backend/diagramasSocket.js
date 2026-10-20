/**
 * Presencia y cambios en vivo de Diagramas.
 * Se registra sobre el mismo Socket.io del chat; no abre otro servidor.
 *
 *   diagramas:entrar  { diagramaId }
 *   diagramas:salir   { diagramaId }
 *   diagramas:cambio  { diagramaId, patch?, xml?, checksum? }
 *   diagramas:presencia { diagramaId, usuarios }
 */
const SALA = 'diagramas:';

function sala(diagramaId) {
    return `${SALA}${diagramaId}`;
}

function rolesDe(user) {
    if (Array.isArray(user?.roles) && user.roles.length) {
        return user.roles.map((rol) => String(rol || '').toLowerCase());
    }
    return user?.rol ? [String(user.rol).toLowerCase()] : [];
}

function esEmpresa(user) {
    return rolesDe(user).includes('empresa');
}

function nombreDe(user) {
    const completo = [user?.nombre, user?.apellido]
        .map((parte) => String(parte || '').trim())
        .filter(Boolean)
        .join(' ');
    return completo || String(user?.username || '').trim() || 'Usuario';
}

function idDiagrama(valor) {
    const id = Number(valor?.diagramaId ?? valor);
    return Number.isInteger(id) && id > 0 ? id : 0;
}

function usuariosEn(io, diagramaId) {
    const room = io.sockets.adapter.rooms.get(sala(diagramaId));
    const vistos = new Map();
    if (!room) return [];
    for (const socketId of room) {
        const conectado = io.sockets.sockets.get(socketId);
        const user = conectado?.user;
        const usuarioId = Number(user?.id);
        if (!Number.isInteger(usuarioId) || usuarioId <= 0 || vistos.has(usuarioId)) continue;
        vistos.set(usuarioId, { id: usuarioId, nombre: nombreDe(user) });
    }
    return [...vistos.values()];
}

function emitirPresencia(io, diagramaId) {
    if (!diagramaId) return;
    io.to(sala(diagramaId)).emit('diagramas:presencia', {
        diagramaId,
        usuarios: usuariosEn(io, diagramaId)
    });
}

function cambioValido(payload) {
    const xml = typeof payload?.xml === 'string' ? payload.xml : '';
    const xmlCorto = xml.length > 0 && xml.length <= 700_000 ? xml : '';
    const patch = payload?.patch;
    if (patch && typeof patch === 'object') {
        let serial = '';
        try {
            serial = JSON.stringify(patch);
        } catch (_err) {
            return null;
        }
        if (!serial || serial.length > 500_000) return null;
        return {
            patch,
            xml: xmlCorto,
            checksum: payload?.checksum ? String(payload.checksum) : null
        };
    }
    if (xmlCorto && /<mx(?:GraphModel|file)[\s>]/i.test(xmlCorto)) {
        return { patch: null, xml: xmlCorto, checksum: null };
    }
    return null;
}

function registrarDiagramasSocket(io, socket) {
    socket.on('diagramas:entrar', (payload) => {
        if (esEmpresa(socket.user)) return;
        const diagramaId = idDiagrama(payload);
        if (!diagramaId) return;
        for (const room of socket.rooms) {
            if (room.startsWith(SALA) && room !== sala(diagramaId)) {
                const anterior = Number(room.slice(SALA.length));
                socket.leave(room);
                emitirPresencia(io, anterior);
            }
        }
        socket.join(sala(diagramaId));
        emitirPresencia(io, diagramaId);
    });

    socket.on('diagramas:salir', (payload) => {
        const diagramaId = idDiagrama(payload);
        if (!diagramaId) return;
        socket.leave(sala(diagramaId));
        emitirPresencia(io, diagramaId);
    });

    socket.on('diagramas:cambio', (payload) => {
        if (esEmpresa(socket.user)) return;
        const diagramaId = idDiagrama(payload);
        if (!diagramaId || !socket.rooms.has(sala(diagramaId))) return;
        const cambio = cambioValido(payload);
        if (!cambio) return;
        socket.to(sala(diagramaId)).emit('diagramas:cambio', {
            diagramaId,
            patch: cambio.patch,
            xml: cambio.xml,
            checksum: cambio.checksum,
            usuarioId: Number(socket.user?.id) || null,
            nombre: nombreDe(socket.user)
        });
    });

    socket.on('disconnecting', () => {
        const abiertos = [...socket.rooms]
            .filter((room) => room.startsWith(SALA))
            .map((room) => Number(room.slice(SALA.length)))
            .filter((id) => id > 0);
        setTimeout(() => {
            for (const diagramaId of abiertos) emitirPresencia(io, diagramaId);
        }, 0);
    });
}

module.exports = { registrarDiagramasSocket };
