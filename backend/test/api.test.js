const assert = require("node:assert/strict");
const { test } = require("node:test");

const baseUrl = process.env.API_BASE_URL || "http://localhost:5000";

async function request(path, { method = "GET", token, body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    return {
        status: response.status,
        data: response.status === 204 ? null : await response.json()
    };
}

test("live API supports health, authentication, role protection, slots, and admin reads", async () => {
    const health = await request("/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.data.database, "connected");

    assert.equal((await request("/api/admin/dashboard")).status, 401);

    const [userLogin, adminLogin, invalidLogin] = await Promise.all([
        request("/api/auth/login", {
            method: "POST",
            body: { email: "user@parkflow.com", password: "User123!" }
        }),
        request("/api/auth/login", {
            method: "POST",
            body: { email: "admin@parkflow.com", password: "Admin123!" }
        }),
        request("/api/auth/login", {
            method: "POST",
            body: { email: "user@parkflow.com", password: "incorrect" }
        })
    ]);

    assert.equal(userLogin.status, 200);
    assert.equal(adminLogin.status, 200);
    assert.equal(invalidLogin.status, 401);
    assert.equal(userLogin.data.user.role, "USER");
    assert.equal(adminLogin.data.user.role, "ADMIN");

    const userToken = userLogin.data.token;
    const adminToken = adminLogin.data.token;
    assert.equal((await request("/api/auth/me", { token: userToken })).data.user.email, "user@parkflow.com");
    assert.equal((await request("/api/admin/dashboard", { token: userToken })).status, 403);

    const [slots, availableSlots, invalidFilter, vehicles, dashboard, users, adminVehicles] = await Promise.all([
        request("/api/parking-slots", { token: userToken }),
        request("/api/parking-slots?status=AVAILABLE", { token: userToken }),
        request("/api/parking-slots?status=INVALID", { token: userToken }),
        request("/api/vehicles", { token: userToken }),
        request("/api/admin/dashboard", { token: adminToken }),
        request("/api/users", { token: adminToken }),
        request("/api/admin/vehicles", { token: adminToken })
    ]);

    assert.equal(slots.status, 200);
    assert.ok(slots.data.slots.length > 0);
    assert.ok(slots.data.slots.every((slot) => ["AVAILABLE", "OCCUPIED", "RESERVED", "MAINTENANCE"].includes(slot.status)));
    assert.equal(availableSlots.status, 200);
    assert.ok(availableSlots.data.slots.every((slot) => slot.status === "AVAILABLE"));
    assert.equal(invalidFilter.status, 400);
    assert.equal(vehicles.status, 200);
    assert.ok(vehicles.data.vehicles.length > 0);
    assert.equal(dashboard.status, 200);
    assert.ok(Number(dashboard.data.totalSlots) >= Number(dashboard.data.availableSlots));
    assert.equal(users.status, 200);
    assert.ok(users.data.users.some((user) => user.email === "user@parkflow.com"));
    assert.equal(adminVehicles.status, 200);

    assert.equal((await request("/api/auth/logout", { method: "POST", token: userToken })).status, 200);
});
