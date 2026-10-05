require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env") });

const bcrypt = require("bcryptjs");
const db = require("./database");

const mallSlots = [
    { mall: "DLF Promenade", area: "Vasant Kunj", slotNumber: "DLP1", slotType: "CAR", status: "AVAILABLE" },
    { mall: "DLF Promenade", area: "Vasant Kunj", slotNumber: "DLP2", slotType: "CAR", status: "OCCUPIED" },
    { mall: "DLF Promenade", area: "Vasant Kunj", slotNumber: "DLP3", slotType: "CAR", status: "RESERVED" },
    { mall: "DLF Promenade", area: "Vasant Kunj", slotNumber: "DLP4", slotType: "BIKE", status: "AVAILABLE" },

    { mall: "DLF Emporio", area: "Vasant Kunj", slotNumber: "DLE1", slotType: "CAR", status: "AVAILABLE" },
    { mall: "DLF Emporio", area: "Vasant Kunj", slotNumber: "DLE2", slotType: "CAR", status: "OCCUPIED" },
    { mall: "DLF Emporio", area: "Vasant Kunj", slotNumber: "DLE3", slotType: "CAR", status: "AVAILABLE" },
    { mall: "DLF Emporio", area: "Vasant Kunj", slotNumber: "DLE4", slotType: "ACCESSIBLE", status: "AVAILABLE" },

    { mall: "Ambience Mall", area: "Vasant Kunj", slotNumber: "AMB1", slotType: "CAR", status: "AVAILABLE" },
    { mall: "Ambience Mall", area: "Vasant Kunj", slotNumber: "AMB2", slotType: "CAR", status: "AVAILABLE" },
    { mall: "Ambience Mall", area: "Vasant Kunj", slotNumber: "AMB3", slotType: "BIKE", status: "RESERVED" },
    { mall: "Ambience Mall", area: "Vasant Kunj", slotNumber: "AMB4", slotType: "CAR", status: "AVAILABLE" },

    { mall: "Pacific Mall", area: "Tagore Garden", slotNumber: "PAC1", slotType: "CAR", status: "AVAILABLE" },
    { mall: "Pacific Mall", area: "Tagore Garden", slotNumber: "PAC2", slotType: "CAR", status: "AVAILABLE" },
    { mall: "Pacific Mall", area: "Tagore Garden", slotNumber: "PAC3", slotType: "CAR", status: "MAINTENANCE" },
    { mall: "Pacific Mall", area: "Tagore Garden", slotNumber: "PAC4", slotType: "BIKE", status: "AVAILABLE" },

    { mall: "The Chanakya", area: "Chanakyapuri", slotNumber: "CHN1", slotType: "CAR", status: "OCCUPIED" },
    { mall: "The Chanakya", area: "Chanakyapuri", slotNumber: "CHN2", slotType: "CAR", status: "AVAILABLE" },
    { mall: "The Chanakya", area: "Chanakyapuri", slotNumber: "CHN3", slotType: "ACCESSIBLE", status: "AVAILABLE" },
    { mall: "The Chanakya", area: "Chanakyapuri", slotNumber: "CHN4", slotType: "CAR", status: "AVAILABLE" },

    { mall: "Vegas Mall", area: "Dwarka", slotNumber: "VEG1", slotType: "CAR", status: "AVAILABLE" },
    { mall: "Vegas Mall", area: "Dwarka", slotNumber: "VEG2", slotType: "CAR", status: "RESERVED" },
    { mall: "Vegas Mall", area: "Dwarka", slotNumber: "VEG3", slotType: "BIKE", status: "AVAILABLE" },
    { mall: "Vegas Mall", area: "Dwarka", slotNumber: "VEG4", slotType: "CAR", status: "OCCUPIED" },

    { mall: "Ansal Plaza", area: "Andrews Ganj", slotNumber: "ANS1", slotType: "CAR", status: "AVAILABLE" },
    { mall: "Ansal Plaza", area: "Andrews Ganj", slotNumber: "ANS2", slotType: "CAR", status: "AVAILABLE" },
    { mall: "Ansal Plaza", area: "Andrews Ganj", slotNumber: "ANS3", slotType: "BIKE", status: "RESERVED" },
    { mall: "Ansal Plaza", area: "Andrews Ganj", slotNumber: "ANS4", slotType: "CAR", status: "AVAILABLE" },

    { mall: "Metro Walk", area: "Rohini", slotNumber: "MTW1", slotType: "CAR", status: "AVAILABLE" },
    { mall: "Metro Walk", area: "Rohini", slotNumber: "MTW2", slotType: "CAR", status: "OCCUPIED" },
    { mall: "Metro Walk", area: "Rohini", slotNumber: "MTW3", slotType: "ACCESSIBLE", status: "AVAILABLE" },
    { mall: "Metro Walk", area: "Rohini", slotNumber: "MTW4", slotType: "CAR", status: "AVAILABLE" },

    { mall: "Cross River Mall", area: "Shahdara", slotNumber: "CRR1", slotType: "CAR", status: "AVAILABLE" },
    { mall: "Cross River Mall", area: "Shahdara", slotNumber: "CRR2", slotType: "CAR", status: "AVAILABLE" },
    { mall: "Cross River Mall", area: "Shahdara", slotNumber: "CRR3", slotType: "BIKE", status: "AVAILABLE" },
    { mall: "Cross River Mall", area: "Shahdara", slotNumber: "CRR4", slotType: "CAR", status: "MAINTENANCE" },

    { mall: "V3S Mall", area: "Laxmi Nagar", slotNumber: "V3S1", slotType: "CAR", status: "AVAILABLE" },
    { mall: "V3S Mall", area: "Laxmi Nagar", slotNumber: "V3S2", slotType: "CAR", status: "RESERVED" },
    { mall: "V3S Mall", area: "Laxmi Nagar", slotNumber: "V3S3", slotType: "CAR", status: "AVAILABLE" },
    { mall: "V3S Mall", area: "Laxmi Nagar", slotNumber: "V3S4", slotType: "BIKE", status: "AVAILABLE", hourlyRate: 25 }
];

const restaurantAndHotelVenues = [
    { name: "Indian Accent", prefix: "IAC", hourlyRate: 35 },
    { name: "Bukhara", prefix: "BUK", hourlyRate: 35 },
    { name: "Dum Pukht", prefix: "DUM", hourlyRate: 35 },
    { name: "Spice Route", prefix: "SPR", hourlyRate: 35 },
    { name: "INJA", prefix: "INJ", hourlyRate: 35 },
    { name: "Karim's", prefix: "KRM", hourlyRate: 25 },
    { name: "Rajinder Da Dhaba", prefix: "RDD", hourlyRate: 25 },
    { name: "Punjabi by Nature", prefix: "PBN", hourlyRate: 25 },
    { name: "Kwality Restaurant", prefix: "KWR", hourlyRate: 25 },
    { name: "The Oberoi", prefix: "OBR", hourlyRate: 35 },
    { name: "ITC Maurya", prefix: "ITC", hourlyRate: 35 },
    { name: "Taj Palace", prefix: "TAJ", hourlyRate: 35 },
    { name: "The Leela Palace", prefix: "TLP", hourlyRate: 35 },
    { name: "The Imperial", prefix: "IMP", hourlyRate: 35 },
    { name: "Shangri-La Eros", prefix: "SLE", hourlyRate: 35 },
    { name: "The Lodhi", prefix: "LOD", hourlyRate: 35 },
    { name: "Andaz Delhi by Hyatt", prefix: "ADH", hourlyRate: 35 },
    { name: "The Claridges", prefix: "CLA", hourlyRate: 25 },
    { name: "Maidens Hotel", prefix: "MAI", hourlyRate: 25 },
    { name: "Crowne Plaza New Delhi Okhla", prefix: "CPO", hourlyRate: 25 },
    { name: "Sheraton New Delhi", prefix: "SND", hourlyRate: 25 }
];

const restaurantAndHotelSlots = restaurantAndHotelVenues.flatMap(({ name, prefix, hourlyRate }) =>
    Array.from({ length: 4 }, (_, index) => ({
        mall: name,
        slotNumber: `${prefix}${index + 1}`,
        slotType: "CAR",
        status: index === 1 ? "OCCUPIED" : "AVAILABLE",
        hourlyRate
    }))
);

const parkingSlots = [...mallSlots, ...restaurantAndHotelSlots];

async function ensureUser({ name, email, password, role }) {
    const passwordHash = await bcrypt.hash(password, 12);
    await db.execute(
        `INSERT INTO users (name, email, password_hash, password, role)
         VALUES (?, ?, ?, NULL, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash),
            password = NULL, role = VALUES(role)`,
        [name, email, passwordHash, role]
    );
    const [rows] = await db.execute("SELECT id FROM users WHERE email = ?", [email]);
    return rows[0].id;
}

async function ensureVehicle(userId, vehicle) {
    await db.execute(
        `INSERT INTO vehicles (user_id, registration_number, make, model, vehicle_type)
         VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE registration_number = VALUES(registration_number)`,
        [userId, vehicle.registrationNumber, vehicle.make, vehicle.model, vehicle.type]
    );
    const [rows] = await db.execute("SELECT id FROM vehicles WHERE registration_number = ?", [vehicle.registrationNumber]);
    return rows[0].id;
}

async function seed() {
    await db.execute(
        "DELETE FROM parking_slots WHERE slot_number IN ('A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1') OR zone IN ('A', 'B', 'C')"
    );

    const adminId = await ensureUser({
        name: "ParkFlow Administrator",
        email: "admin@parkflow.com",
        password: "Admin123!",
        role: "ADMIN"
    });
    const userId = await ensureUser({
        name: "Demo User",
        email: "user@parkflow.com",
        password: "User123!",
        role: "USER"
    });
    const requestUserId = await ensureUser({
        name: "Request Demo Guest",
        email: "student@parkflow.com",
        password: "Student123!",
        role: "USER"
    });

    const carId = await ensureVehicle(userId, {
        registrationNumber: "DLF-CAR-01", make: "Honda", model: "City", type: "CAR"
    });
    await ensureVehicle(userId, {
        registrationNumber: "DLF-BIKE-01", make: "Bajaj", model: "Pulsar", type: "BIKE"
    });
    await ensureVehicle(requestUserId, {
        registrationNumber: "DLF-GUEST-01", make: "Maruti", model: "Swift", type: "CAR"
    });
    await db.execute(
        "UPDATE parking_requests SET status = 'CANCELLED' WHERE user_id = ? AND status = 'PENDING'",
        [requestUserId]
    );

    for (const slot of parkingSlots) {
        await db.execute(
            `INSERT INTO parking_slots (slot_number, zone, slot_type, status, hourly_rate)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE zone = VALUES(zone), slot_type = VALUES(slot_type), hourly_rate = VALUES(hourly_rate)`,
            [slot.slotNumber, slot.mall, slot.slotType, slot.status, slot.hourlyRate || 25]
        );
    }

    const [allocatedSlotRows] = await db.execute("SELECT id FROM parking_slots WHERE slot_number = 'DLP1'");
    const allocatedSlotId = allocatedSlotRows[0]?.id;

    if (allocatedSlotId) {
        const [existingAllocations] = await db.execute(
            "SELECT id FROM allocations WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
            [userId]
        );

        if (!existingAllocations.length) {
            const [existingApprovedRequest] = await db.execute(
                "SELECT id FROM parking_requests WHERE user_id = ? AND parking_slot_id = ? AND status = 'APPROVED' LIMIT 1",
                [userId, allocatedSlotId]
            );
            let requestId = existingApprovedRequest[0]?.id;
            if (!requestId) {
                const [result] = await db.execute(
                    `INSERT INTO parking_requests (user_id, vehicle_id, parking_slot_id, status, reviewed_at, reviewed_by)
                     VALUES (?, ?, ?, 'APPROVED', CURRENT_TIMESTAMP, ?)`,
                    [userId, carId, allocatedSlotId, adminId]
                );
                requestId = result.insertId;
            }

            await db.execute(
                "INSERT IGNORE INTO allocations (request_id, user_id, vehicle_id, parking_slot_id) VALUES (?, ?, ?, ?)",
                [requestId, userId, carId, allocatedSlotId]
            );
            await db.execute("UPDATE parking_slots SET status = 'RESERVED' WHERE id = ?", [allocatedSlotId]);
        }
    }

    console.log("Demo data is ready.");
    console.log("Admin: admin@parkflow.com / Admin123!");
    console.log("User:  user@parkflow.com / User123!");
}

seed().catch((error) => {
    console.error("Seeding failed:", error.message);
    process.exitCode = 1;
}).finally(async () => {
    await db.end();
});
