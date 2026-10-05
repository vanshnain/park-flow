require("dotenv").config();

const path = require("node:path");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("./db/database");

const app = express();
const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET;
const SLOT_STATUSES = ["AVAILABLE", "OCCUPIED", "RESERVED", "MAINTENANCE"];
const VEHICLE_TYPES = ["CAR", "BIKE", "SUV", "OTHER"];

if (!JWT_SECRET || Buffer.byteLength(JWT_SECRET) < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters.");
}

app.use(cors({
    origin: process.env.CORS_ORIGIN || `http://localhost:${PORT}`,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "20kb" }));

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const asyncRoute = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
};

const requiredText = (value, label, maxLength) => {
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
        throw new HttpError(400, `${label} is required and must be at most ${maxLength} characters.`);
    }
    return value.trim();
};

const positiveId = (value, label = "ID") => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1) {
        throw new HttpError(400, `${label} must be a positive integer.`);
    }
    return id;
};

const authenticate = asyncRoute(async (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw new HttpError(401, "Sign in to continue.");

    try {
        req.user = jwt.verify(token, JWT_SECRET);
    } catch {
        throw new HttpError(401, "Your session has expired. Please sign in again.");
    }

    const [users] = await db.execute(
        "SELECT id, name, email, role FROM users WHERE id = ?",
        [req.user.id]
    );
    if (!users.length) throw new HttpError(401, "This account is no longer available.");
    req.user = users[0];
    next();
});

const requireAdmin = (req, res, next) => {
    if (req.user.role !== "ADMIN") return next(new HttpError(403, "Administrator access is required."));
    next();
};

const withTransaction = async (work) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const autoAllocatePendingRequests = async () => {
    const [pendingRequests] = await db.execute(
        "SELECT id FROM parking_requests WHERE status = 'PENDING' ORDER BY requested_at, id"
    );
    let allocatedCount = 0;

    for (const { id } of pendingRequests) {
        const allocated = await withTransaction(async (connection) => {
            const [requests] = await connection.execute(
                "SELECT * FROM parking_requests WHERE id = ? FOR UPDATE",
                [id]
            );
            const request = requests[0];
            if (!request || request.status !== "PENDING") return false;

            const [slots] = await connection.execute(
                "SELECT id, status, hourly_rate FROM parking_slots WHERE id = ? FOR UPDATE",
                [request.parking_slot_id]
            );
            const [vehicles] = await connection.execute(
                "SELECT id FROM vehicles WHERE id = ? AND user_id = ?",
                [request.vehicle_id, request.user_id]
            );
            const [activeAllocations] = await connection.execute(
                "SELECT id FROM allocations WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
                [request.user_id]
            );

            if (!slots.length || slots[0].status !== "AVAILABLE" || !vehicles.length || activeAllocations.length) {
                await connection.execute(
                    "UPDATE parking_requests SET status = 'REJECTED', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
                    [id]
                );
                return false;
            }

            const hourlyRate = Number(slots[0].hourly_rate);
            const totalAmount = Number(hourlyRate.toFixed(2));
            await connection.execute(
                "UPDATE parking_requests SET status = 'APPROVED', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
                [id]
            );
            await connection.execute(
                `INSERT INTO allocations (request_id, user_id, vehicle_id, parking_slot_id,
                    duration_hours, hourly_rate, total_amount, payment_status)
                 VALUES (?, ?, ?, ?, 1, ?, ?, 'DEMO_PAID')`,
                [id, request.user_id, request.vehicle_id, request.parking_slot_id, hourlyRate, totalAmount]
            );
            await connection.execute(
                "UPDATE parking_slots SET status = 'RESERVED' WHERE id = ?",
                [request.parking_slot_id]
            );
            return true;
        });

        if (allocated) allocatedCount += 1;
    }

    return allocatedCount;
};

const getUserById = async (connection, id) => {
    const [rows] = await connection.execute(
        "SELECT id, name, email, role FROM users WHERE id = ?",
        [id]
    );
    return rows[0];
};

const serveFrontend = (file) => (req, res) => {
    res.sendFile(path.resolve(__dirname, "../frontend", file));
};

app.get("/", serveFrontend("index.html"));
app.get("/index.html", serveFrontend("index.html"));
app.get("/style.css", serveFrontend("style.css"));
app.get("/script.js", serveFrontend("script.js"));
app.get("/api/health", asyncRoute(async (req, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
}));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
    const name = requiredText(req.body.name, "Name", 100);
    const email = requiredText(req.body.email, "Email", 254).toLowerCase();
    const password = req.body.password;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
        throw new HttpError(400, "Password must be between 8 and 72 characters.");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await db.execute(
        "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'USER')",
        [name, email, passwordHash]
    ).catch((error) => {
        if (error.code === "ER_DUP_ENTRY") throw new HttpError(409, "An account with this email already exists.");
        throw error;
    });
    const user = await getUserById(db, result.insertId);
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "8h" });
    res.status(201).json({ user, token });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
    const email = requiredText(req.body.email, "Email", 254).toLowerCase();
    const password = req.body.password;
    if (typeof password !== "string" || !password) throw new HttpError(400, "Password is required.");

    const [users] = await db.execute(
        "SELECT id, name, email, role, password_hash FROM users WHERE email = ?",
        [email]
    );
    const user = users[0];
    if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
        throw new HttpError(401, "Email or password is incorrect.");
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "8h" });
    delete user.password_hash;
    res.json({ user, token });
}));

app.post("/api/auth/logout", authenticate, (req, res) => res.json({ message: "Signed out." }));
app.get("/api/auth/me", authenticate, asyncRoute(async (req, res) => {
    res.json({ user: req.user });
}));

app.get("/api/users/me", authenticate, asyncRoute(async (req, res) => {
    res.json({ user: req.user });
}));
app.patch("/api/users/me", authenticate, asyncRoute(async (req, res) => {
    const name = requiredText(req.body.name, "Name", 100);
    await db.execute("UPDATE users SET name = ? WHERE id = ?", [name, req.user.id]);
    res.json({ user: await getUserById(db, req.user.id) });
}));
app.get("/api/users", authenticate, requireAdmin, asyncRoute(async (req, res) => {
    const [users] = await db.execute(
        `SELECT u.id, u.name, u.email, u.role, u.created_at,
            COUNT(DISTINCT v.id) AS vehicle_count,
            COUNT(DISTINCT CASE WHEN a.status = 'ACTIVE' THEN a.id END) AS active_allocations
         FROM users u
         LEFT JOIN vehicles v ON v.user_id = u.id
         LEFT JOIN allocations a ON a.user_id = u.id
         GROUP BY u.id ORDER BY u.created_at DESC`
    );
    res.json({ users });
}));

app.get("/api/vehicles", authenticate, asyncRoute(async (req, res) => {
    const [vehicles] = await db.execute(
        "SELECT id, user_id, registration_number, make, model, vehicle_type, created_at FROM vehicles WHERE user_id = ? ORDER BY created_at DESC",
        [req.user.id]
    );
    res.json({ vehicles });
}));
app.post("/api/vehicles", authenticate, asyncRoute(async (req, res) => {
    const registrationNumber = requiredText(req.body.registrationNumber, "Registration number", 20).toUpperCase();
    const make = requiredText(req.body.make, "Make", 60);
    const model = requiredText(req.body.model, "Model", 60);
    const vehicleType = String(req.body.vehicleType || "CAR").toUpperCase();
    if (!/^[A-Z0-9 -]+$/.test(registrationNumber)) throw new HttpError(400, "Registration number contains invalid characters.");
    if (!VEHICLE_TYPES.includes(vehicleType)) throw new HttpError(400, "Choose a valid vehicle type.");

    try {
        const [result] = await db.execute(
            "INSERT INTO vehicles (user_id, registration_number, make, model, vehicle_type) VALUES (?, ?, ?, ?, ?)",
            [req.user.id, registrationNumber, make, model, vehicleType]
        );
        const [vehicles] = await db.execute("SELECT * FROM vehicles WHERE id = ?", [result.insertId]);
        res.status(201).json({ vehicle: vehicles[0] });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") throw new HttpError(409, "That registration number is already registered.");
        throw error;
    }
}));
app.delete("/api/vehicles/:id", authenticate, asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, "Vehicle ID");
    try {
        const [result] = await db.execute("DELETE FROM vehicles WHERE id = ? AND user_id = ?", [id, req.user.id]);
        if (!result.affectedRows) throw new HttpError(404, "Vehicle not found.");
    } catch (error) {
        if (error.code === "ER_ROW_IS_REFERENCED_2") throw new HttpError(409, "This vehicle has request history and cannot be removed.");
        throw error;
    }
    res.status(204).end();
}));
app.get("/api/admin/vehicles", authenticate, requireAdmin, asyncRoute(async (req, res) => {
    const [vehicles] = await db.execute(
        `SELECT v.id, v.registration_number, v.make, v.model, v.vehicle_type,
            u.id AS user_id, u.name AS user_name, u.email AS user_email
         FROM vehicles v JOIN users u ON u.id = v.user_id ORDER BY v.created_at DESC`
    );
    res.json({ vehicles });
}));

app.get("/api/parking-slots", authenticate, asyncRoute(async (req, res) => {
    const filters = [];
    const values = [];
    if (req.query.q) {
        filters.push("(s.slot_number LIKE ? OR s.zone LIKE ?)");
        values.push(`%${String(req.query.q).slice(0, 40)}%`, `%${String(req.query.q).slice(0, 40)}%`);
    }
    if (req.query.zone) { filters.push("s.zone = ?"); values.push(String(req.query.zone).slice(0, 50)); }
    if (req.query.status) {
        const status = String(req.query.status).toUpperCase();
        if (!SLOT_STATUSES.includes(status)) throw new HttpError(400, "Choose a valid parking status.");
        filters.push("s.status = ?"); values.push(status);
    }
    if (req.query.type) {
        const type = String(req.query.type).toUpperCase();
        if (!["CAR", "BIKE", "ACCESSIBLE"].includes(type)) throw new HttpError(400, "Choose a valid parking space type.");
        filters.push("s.slot_type = ?"); values.push(type);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const [slots] = await db.execute(
        `SELECT s.id, s.slot_number, s.zone, s.slot_type, s.status, s.hourly_rate,
            EXISTS (SELECT 1 FROM parking_requests pr WHERE pr.parking_slot_id = s.id AND pr.status = 'PENDING') AS has_pending_request
         FROM parking_slots s ${where} ORDER BY s.zone, s.slot_number`,
        values
    );
    res.json({ slots });
}));
app.post("/api/parking-slots", authenticate, requireAdmin, asyncRoute(async (req, res) => {
    const slotNumber = requiredText(req.body.slotNumber, "Slot number", 10).toUpperCase();
    const zone = requiredText(req.body.zone, "Zone", 50);
    const slotType = String(req.body.slotType || "CAR").toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(slotNumber) || !/^[A-Za-z0-9&/().' -]+$/.test(zone)) throw new HttpError(400, "Slot number must use letters, numbers, or hyphens; zone names can include spaces and punctuation.");
    if (!["CAR", "BIKE", "ACCESSIBLE"].includes(slotType)) throw new HttpError(400, "Choose a valid slot type.");
    try {
        const [result] = await db.execute(
            "INSERT INTO parking_slots (slot_number, zone, slot_type) VALUES (?, ?, ?)",
            [slotNumber, zone, slotType]
        );
        res.status(201).json({ slot: { id: result.insertId, slotNumber, zone, slotType, status: "AVAILABLE" } });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") throw new HttpError(409, "That slot number already exists.");
        throw error;
    }
}));
app.patch("/api/parking-slots/:id", authenticate, requireAdmin, asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, "Slot ID");
    const [currentRows] = await db.execute("SELECT * FROM parking_slots WHERE id = ?", [id]);
    const current = currentRows[0];
    if (!current) throw new HttpError(404, "Parking slot not found.");

    const slotNumber = req.body.slotNumber === undefined ? current.slot_number : requiredText(req.body.slotNumber, "Slot number", 10).toUpperCase();
    const zone = req.body.zone === undefined ? current.zone : requiredText(req.body.zone, "Zone", 50);
    const slotType = req.body.slotType === undefined ? current.slot_type : String(req.body.slotType).toUpperCase();
    const status = req.body.status === undefined ? current.status : String(req.body.status).toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(slotNumber) || !/^[A-Za-z0-9&/().' -]+$/.test(zone)) throw new HttpError(400, "Slot number must use letters, numbers, or hyphens; zone names can include spaces and punctuation.");
    if (!["CAR", "BIKE", "ACCESSIBLE"].includes(slotType)) throw new HttpError(400, "Choose a valid slot type.");
    if (!SLOT_STATUSES.includes(status)) throw new HttpError(400, "Choose a valid slot status.");
    if (status === "AVAILABLE" && current.status !== "AVAILABLE") {
        const [active] = await db.execute("SELECT id FROM allocations WHERE parking_slot_id = ? AND status = 'ACTIVE' LIMIT 1", [id]);
        if (active.length) throw new HttpError(409, "Cancel or reassign the active allocation before making this slot available.");
    }

    try {
        await db.execute(
            "UPDATE parking_slots SET slot_number = ?, zone = ?, slot_type = ?, status = ? WHERE id = ?",
            [slotNumber, zone, slotType, status, id]
        );
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") throw new HttpError(409, "That slot number already exists.");
        throw error;
    }
    res.json({ slot: { id, slotNumber, zone, slotType, status } });
}));
app.delete("/api/parking-slots/:id", authenticate, requireAdmin, asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, "Slot ID");
    try {
        const [result] = await db.execute("DELETE FROM parking_slots WHERE id = ?", [id]);
        if (!result.affectedRows) throw new HttpError(404, "Parking slot not found.");
    } catch (error) {
        if (error.code === "ER_ROW_IS_REFERENCED_2") throw new HttpError(409, "This slot has request history and cannot be deleted.");
        throw error;
    }
    res.status(204).end();
}));

app.post("/api/parking-requests", authenticate, asyncRoute(async (req, res) => {
    const vehicleId = positiveId(req.body.vehicleId, "Vehicle ID");
    const slotId = positiveId(req.body.slotId, "Slot ID");
    const durationHours = req.body.durationHours === undefined ? 1 : Number(req.body.durationHours);
    if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 12) {
        throw new HttpError(400, "Choose a parking duration between 1 and 12 hours.");
    }
    const request = await withTransaction(async (connection) => {
        const [slots] = await connection.execute("SELECT id, status, hourly_rate FROM parking_slots WHERE id = ? FOR UPDATE", [slotId]);
        if (!slots.length) throw new HttpError(404, "Parking slot not found.");
        if (slots[0].status !== "AVAILABLE") throw new HttpError(409, "This parking slot is no longer available.");
        const hourlyRate = Number(slots[0].hourly_rate);
        const totalAmount = Number((hourlyRate * durationHours).toFixed(2));
        const [vehicles] = await connection.execute("SELECT id FROM vehicles WHERE id = ? AND user_id = ?", [vehicleId, req.user.id]);
        if (!vehicles.length) throw new HttpError(400, "Choose one of your registered vehicles.");
        const [conflicts] = await connection.execute(
            `SELECT id FROM parking_requests WHERE parking_slot_id = ? AND status = 'PENDING'
             UNION SELECT id FROM parking_requests WHERE parking_slot_id = ? AND status = 'APPROVED'
             UNION SELECT id FROM allocations WHERE parking_slot_id = ? AND status = 'ACTIVE'
             UNION SELECT id FROM parking_requests WHERE user_id = ? AND status = 'PENDING'
             UNION SELECT id FROM allocations WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1`,
            [slotId, slotId, slotId, req.user.id, req.user.id]
        );
        if (conflicts.length) throw new HttpError(409, "You or this slot already has a pending request or active allocation.");
        const [requestResult] = await connection.execute(
            `INSERT INTO parking_requests (user_id, vehicle_id, parking_slot_id, status, reviewed_at)
             VALUES (?, ?, ?, 'APPROVED', CURRENT_TIMESTAMP)`,
            [req.user.id, vehicleId, slotId]
        );
        const [allocationResult] = await connection.execute(
            `INSERT INTO allocations (request_id, user_id, vehicle_id, parking_slot_id, duration_hours,
                hourly_rate, total_amount, payment_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'DEMO_PAID')`,
            [requestResult.insertId, req.user.id, vehicleId, slotId, durationHours, hourlyRate, totalAmount]
        );
        await connection.execute("UPDATE parking_slots SET status = 'RESERVED' WHERE id = ?", [slotId]);
        const [rows] = await connection.execute(
            `SELECT pr.id, pr.status, pr.requested_at, s.slot_number, s.zone,
                v.registration_number, v.make, v.model, a.id AS allocation_id,
                a.duration_hours, a.hourly_rate, a.total_amount, a.payment_status
             FROM parking_requests pr JOIN parking_slots s ON s.id = pr.parking_slot_id
             JOIN vehicles v ON v.id = pr.vehicle_id JOIN allocations a ON a.request_id = pr.id
             WHERE pr.id = ?`,
            [requestResult.insertId]
        );
        return rows[0];
    });
    res.status(201).json({ request, message: "Parking booked and automatically allocated. Demo payment recorded." });
}));
app.get("/api/parking-requests", authenticate, asyncRoute(async (req, res) => {
    const [requests] = await db.execute(
        `SELECT pr.id, pr.status, pr.requested_at, pr.reviewed_at, pr.user_id,
            u.name AS user_name, u.email AS user_email, pr.vehicle_id, v.registration_number,
            pr.parking_slot_id AS slot_id, s.slot_number, s.zone,
            a.duration_hours, a.hourly_rate, a.total_amount, a.payment_status
         FROM parking_requests pr JOIN users u ON u.id = pr.user_id
         JOIN vehicles v ON v.id = pr.vehicle_id JOIN parking_slots s ON s.id = pr.parking_slot_id
         LEFT JOIN allocations a ON a.request_id = pr.id
         ${req.user.role === "ADMIN" ? "" : "WHERE pr.user_id = ?"}
         ORDER BY pr.requested_at DESC`,
        req.user.role === "ADMIN" ? [] : [req.user.id]
    );
    res.json({ requests });
}));
app.delete("/api/parking-requests/:id", authenticate, asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, "Request ID");
    const [result] = await db.execute(
        "UPDATE parking_requests SET status = 'CANCELLED' WHERE id = ? AND user_id = ? AND status = 'PENDING'",
        [id, req.user.id]
    );
    if (!result.affectedRows) throw new HttpError(409, "Only your pending requests can be cancelled.");
    res.json({ message: "Request cancelled." });
}));

app.post("/api/admin/parking-requests/:id/approve", authenticate, requireAdmin, asyncRoute(async (req, res) => {
    const requestId = positiveId(req.params.id, "Request ID");
    const slotId = req.body.slotId === undefined ? null : positiveId(req.body.slotId, "Slot ID");
    const allocation = await withTransaction(async (connection) => {
        const [requests] = await connection.execute("SELECT * FROM parking_requests WHERE id = ? FOR UPDATE", [requestId]);
        const request = requests[0];
        if (!request) throw new HttpError(404, "Parking request not found.");
        if (request.status !== "PENDING") throw new HttpError(409, "This request has already been reviewed.");
        const assignedSlotId = slotId || request.parking_slot_id;
        const [slots] = await connection.execute("SELECT id, status FROM parking_slots WHERE id = ? FOR UPDATE", [assignedSlotId]);
        if (!slots.length) throw new HttpError(404, "Parking slot not found.");
        if (slots[0].status !== "AVAILABLE") throw new HttpError(409, "The selected slot is not available.");
        const [active] = await connection.execute("SELECT id FROM allocations WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1", [request.user_id]);
        if (active.length) throw new HttpError(409, "This user already has an active allocation.");

        await connection.execute(
            "UPDATE parking_requests SET parking_slot_id = ?, status = 'APPROVED', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?",
            [assignedSlotId, req.user.id, requestId]
        );
        const [result] = await connection.execute(
            "INSERT INTO allocations (request_id, user_id, vehicle_id, parking_slot_id) VALUES (?, ?, ?, ?)",
            [requestId, request.user_id, request.vehicle_id, assignedSlotId]
        );
        await connection.execute("UPDATE parking_slots SET status = 'RESERVED' WHERE id = ?", [assignedSlotId]);
        await connection.execute(
            "UPDATE parking_requests SET status = 'REJECTED', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE parking_slot_id = ? AND id <> ? AND status = 'PENDING'",
            [req.user.id, assignedSlotId, requestId]
        );
        return { id: result.insertId, requestId, slotId: assignedSlotId, status: "ACTIVE" };
    });
    res.json({ allocation, message: "Request approved and slot reserved." });
}));
app.post("/api/admin/parking-requests/:id/reject", authenticate, requireAdmin, asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, "Request ID");
    const [result] = await db.execute(
        "UPDATE parking_requests SET status = 'REJECTED', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ? AND status = 'PENDING'",
        [req.user.id, id]
    );
    if (!result.affectedRows) throw new HttpError(404, "Pending request not found.");
    res.json({ message: "Request rejected." });
}));

app.get("/api/allocations", authenticate, asyncRoute(async (req, res) => {
    const [allocations] = await db.execute(
        `SELECT a.id, a.request_id, a.user_id, a.vehicle_id, a.parking_slot_id AS slot_id,
            a.status, a.allocated_at, a.ended_at, u.name AS user_name, u.email AS user_email,
            v.registration_number, v.make, v.model, s.slot_number, s.zone,
            a.duration_hours, a.hourly_rate, a.total_amount, a.payment_status
         FROM allocations a JOIN users u ON u.id = a.user_id
         JOIN vehicles v ON v.id = a.vehicle_id JOIN parking_slots s ON s.id = a.parking_slot_id
         ${req.user.role === "ADMIN" ? "" : "WHERE a.user_id = ?"}
         ORDER BY a.allocated_at DESC`,
        req.user.role === "ADMIN" ? [] : [req.user.id]
    );
    res.json({ allocations });
}));
app.post("/api/allocations/:id/cancel", authenticate, asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, "Allocation ID");
    await withTransaction(async (connection) => {
        const [rows] = await connection.execute(
            "SELECT * FROM allocations WHERE id = ? AND user_id = ? FOR UPDATE",
            [id, req.user.id]
        );
        const allocation = rows[0];
        if (!allocation || allocation.status !== "ACTIVE") throw new HttpError(409, "Only your active allocations can be cancelled.");
        await connection.execute("UPDATE allocations SET status = 'CANCELLED', ended_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
        await connection.execute("UPDATE parking_requests SET status = 'CANCELLED' WHERE id = ?", [allocation.request_id]);
        await connection.execute(
            "UPDATE parking_slots SET status = 'AVAILABLE' WHERE id = ? AND status = 'RESERVED'",
            [allocation.parking_slot_id]
        );
    });
    res.json({ message: "Allocation cancelled." });
}));
app.patch("/api/admin/allocations/:id/slot", authenticate, requireAdmin, asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, "Allocation ID");
    const newSlotId = positiveId(req.body.slotId, "Slot ID");
    await withTransaction(async (connection) => {
        const [rows] = await connection.execute("SELECT * FROM allocations WHERE id = ? FOR UPDATE", [id]);
        const allocation = rows[0];
        if (!allocation || allocation.status !== "ACTIVE") throw new HttpError(404, "Active allocation not found.");
        if (allocation.parking_slot_id === newSlotId) return;
        const [slots] = await connection.execute("SELECT id, status FROM parking_slots WHERE id = ? FOR UPDATE", [newSlotId]);
        if (!slots.length || slots[0].status !== "AVAILABLE") throw new HttpError(409, "The selected slot is not available.");
        await connection.execute("UPDATE parking_slots SET status = 'AVAILABLE' WHERE id = ? AND status = 'RESERVED'", [allocation.parking_slot_id]);
        await connection.execute("UPDATE parking_slots SET status = 'RESERVED' WHERE id = ?", [newSlotId]);
        await connection.execute("UPDATE allocations SET parking_slot_id = ? WHERE id = ?", [newSlotId, id]);
        await connection.execute("UPDATE parking_requests SET parking_slot_id = ? WHERE id = ?", [newSlotId, allocation.request_id]);
    });
    res.json({ message: "Allocation reassigned." });
}));

app.get("/api/admin/dashboard", authenticate, requireAdmin, asyncRoute(async (req, res) => {
    const [[slots]] = await db.execute(
        `SELECT COUNT(*) AS totalSlots,
            SUM(status = 'AVAILABLE') AS availableSlots,
            SUM(status = 'OCCUPIED') AS occupiedSlots,
            SUM(status = 'RESERVED') AS reservedSlots,
            SUM(status = 'MAINTENANCE') AS maintenanceSlots FROM parking_slots`
    );
    const [[users]] = await db.execute("SELECT COUNT(*) AS totalUsers FROM users WHERE role = 'USER'");
    const [[requests]] = await db.execute("SELECT COUNT(*) AS pendingRequests FROM parking_requests WHERE status = 'PENDING'");
    const [[revenue]] = await db.execute(
        `SELECT COALESCE(SUM(total_amount), 0) AS totalRevenue,
            COUNT(*) AS paidBookings
         FROM allocations WHERE payment_status = 'DEMO_PAID' AND status <> 'CANCELLED'`
    );
    res.json({ ...slots, ...users, ...requests, ...revenue });
}));

app.use((req, res, next) => next(new HttpError(404, "Endpoint not found.")));
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
        return res.status(400).json({ error: "Request body must contain valid JSON." });
    }
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? "Something went wrong. Please try again." : error.message });
});

db.query("SELECT 1").then(() => {
    return autoAllocatePendingRequests().then((allocatedCount) => {
        if (allocatedCount) console.log(`Automatically allocated ${allocatedCount} pending booking(s).`);
        app.listen(PORT, () => console.log(`ParkFlow is running at http://localhost:${PORT}`));
    });
}).catch((error) => {
    console.error("MySQL connection failed:", error.message);
    process.exitCode = 1;
});