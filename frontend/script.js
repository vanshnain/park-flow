const API = "/api";
const state = { token: localStorage.getItem("parkflow_token"), user: null, page: "dashboard", selectedSlot: null };
const pageNames = {
  dashboard: ["YOUR PARKING, IN ONE PLACE", "Overview"], slots: ["FIND YOUR NEXT SPOT", "Parking slots"],
  vehicles: ["YOUR REGISTERED VEHICLES", "My vehicles"], bookings: ["TRACK EVERY DECISION", "Requests & allocations"],
  profile: ["YOUR ACCOUNT DETAILS", "Profile"], "admin-dashboard": ["PARKING OPERATIONS", "Admin overview"],
  "admin-slots": ["SPACE INVENTORY", "Manage parking"], "admin-users": ["ACCOUNT DIRECTORY", "Users & vehicles"],
  "admin-requests": ["REVIEW QUEUE", "Request review"], "admin-allocations": ["LIVE ASSIGNMENTS", "Allocations"]
};

const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const formatRupees = (amount) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(amount) || 0);

function bookingForm(slot, vehicles) {
  const rate = Number(slot.hourly_rate || 25);
  return `<form id="requestForm" class="selection-bar" data-hourly-rate="${rate}"><div><span class="eyebrow">SELECTED SPACE</span><strong>${escapeHTML(slot.slot_number)} <span>· ${escapeHTML(slot.zone)}</span></strong><small>${formatRupees(rate)} per hour · demo checkout</small></div><label class="vehicle-select">Vehicle<select name="vehicleId" required>${vehicles.map((vehicle) => `<option value="${vehicle.id}">${escapeHTML(vehicle.registration_number)} · ${escapeHTML(vehicle.make)} ${escapeHTML(vehicle.model)}</option>`).join("")}</select></label><label class="vehicle-select">Hours<select name="durationHours">${[1, 2, 3, 4, 6, 8, 12].map((hours) => `<option value="${hours}">${hours} ${hours === 1 ? "hour" : "hours"}</option>`).join("")}</select></label><div class="booking-total"><span>Demo total</span><strong data-booking-total>${formatRupees(rate)}</strong></div><button class="button button-primary" type="submit">Pay ${formatRupees(rate)} (demo) &amp; book</button></form><p class="muted small-copy">Demo payment only. No real money is charged.</p>`;
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) {
      localStorage.removeItem("parkflow_token");
      state.token = null;
      state.user = null;
      showAuth();
    }
    throw new Error(data?.error || "The request could not be completed.");
  }
  return data;
}

function toast(message, type = "success") {
  const element = document.getElementById("toast");
  element.textContent = message;
  element.className = `toast visible ${type}`;
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => { element.className = "toast"; }, 3400);
}

function showAuth(mode = "login") {
  document.getElementById("appView").hidden = true;
  document.getElementById("authView").hidden = false;
  document.getElementById("loginForm").hidden = mode !== "login";
  document.getElementById("registerForm").hidden = mode !== "register";
  document.getElementById("showLogin").classList.toggle("active", mode === "login");
  document.getElementById("showRegister").classList.toggle("active", mode === "register");
  document.getElementById("authError").hidden = true;
}

function showApp() {
  document.getElementById("authView").hidden = true;
  document.getElementById("appView").hidden = false;
  document.getElementById("adminNav").hidden = state.user.role !== "ADMIN";
  document.getElementById("userName").textContent = state.user.name;
  document.getElementById("userRole").textContent = state.user.role;
  document.getElementById("userAvatar").textContent = state.user.name.trim().charAt(0).toUpperCase();
  document.getElementById("footerDate").textContent = new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date());
  navigate(state.user.role === "ADMIN" ? "admin-dashboard" : "dashboard");
}

function setPage(page, content, loading = false) {
  const [eyebrow, title] = pageNames[page] || pageNames.dashboard;
  state.page = page;
  document.getElementById("pageTitle").textContent = title;
  document.getElementById("pageEyebrow").textContent = eyebrow;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  const main = document.getElementById("pageContent");
  main.innerHTML = loading ? '<div class="loading-state"><span class="spinner"></span>Loading your parking data…</div>' : content;
  main.focus({ preventScroll: true });
}

function errorPage(page, error, retry) {
  setPage(page, `<div class="empty-state"><span class="empty-symbol">!</span><h2>We couldn’t load this view</h2><p>${escapeHTML(error.message)}</p><button class="button button-primary" data-action="retry" data-page="${escapeHTML(retry)}">Try again</button></div>`);
}

function statusBadge(status) {
  return `<span class="status-badge status-${escapeHTML(String(status).toLowerCase())}">${escapeHTML(status)}</span>`;
}

function statTile(label, value, tone, foot = "") {
  return `<article class="stat-tile"><div class="stat-top"><span>${escapeHTML(label)}</span><span class="stat-indicator ${tone}"></span></div><strong>${escapeHTML(value)}</strong><small>${escapeHTML(foot)}</small></article>`;
}

function emptyState(title, message, action = "") {
  return `<div class="empty-state"><span class="empty-symbol">⌑</span><h2>${escapeHTML(title)}</h2><p>${escapeHTML(message)}</p>${action}</div>`;
}

function navigate(page) {
  if (page.startsWith("admin-") && state.user.role !== "ADMIN") page = "dashboard";
  state.selectedSlot = null;
  setPage(page, "", true);
  const loaders = {
    dashboard: renderDashboard, slots: renderSlots, vehicles: renderVehicles, bookings: renderBookings, profile: renderProfile,
    "admin-dashboard": renderAdminDashboard, "admin-slots": renderAdminSlots, "admin-users": renderAdminUsers,
    "admin-requests": renderAdminRequests, "admin-allocations": renderAdminAllocations
  };
  (loaders[page] || renderDashboard)(page).catch((error) => errorPage(page, error, page));
}

async function renderDashboard() {
  const [{ slots }, { allocations }, { requests }] = await Promise.all([
    api("/parking-slots"), api("/allocations"), api("/parking-requests")
  ]);
  const available = slots.filter((slot) => slot.status === "AVAILABLE").length;
  const active = allocations.find((allocation) => allocation.status === "ACTIVE");
  const pending = requests.filter((request) => request.status === "PENDING").length;
  const latest = requests[0];
  setPage("dashboard", `
    <section class="welcome-row"><div><span class="eyebrow">${new Date().toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}</span><h2>Good to see you, ${escapeHTML(state.user.name.split(" ")[0])}.</h2><p>Choose a destination and book instantly from ${formatRupees(25)} per hour.</p></div><button class="button button-primary" data-page="slots">Find a parking spot <span>↗</span></button></section>
    <section class="stat-grid">${statTile("Available spaces", available, "mint", "Ready to request")}${statTile("My requests", requests.length, "amber", `${pending} awaiting review`)}${statTile("Active allocation", active ? active.slot_number : "—", "green", active ? `Zone ${escapeHTML(active.zone)}` : "No active space")}</section>
    <section class="dashboard-columns"><div class="section-block"><div class="section-heading"><div><span class="eyebrow">YOUR SPACE</span><h2>${active ? "Currently allocated" : "No current allocation"}</h2></div><button class="text-button" data-page="bookings">View all ↗</button></div>${active ? `<div class="allocation-feature"><div class="allocation-number">${escapeHTML(active.slot_number)}</div><div><span class="eyebrow">ZONE ${escapeHTML(active.zone)}</span><h3>${escapeHTML(active.make)} ${escapeHTML(active.model)}</h3><p>${escapeHTML(active.registration_number)} · Approved ${new Date(active.allocated_at).toLocaleDateString()}</p></div>${statusBadge(active.status)}</div>` : emptyState("Your next spot is one request away", "Browse available spaces and choose the vehicle you’ll bring.", '<button class="button button-outline" data-page="slots">Browse parking</button>')}</div>
    <aside class="section-block recent-block"><div class="section-heading"><div><span class="eyebrow">RECENT ACTIVITY</span><h2>Latest request</h2></div></div>${latest ? `<div class="recent-line"><span class="recent-slot">${escapeHTML(latest.slot_number)}</span><div><strong>Zone ${escapeHTML(latest.zone)}</strong><small>${escapeHTML(latest.registration_number)}</small></div>${statusBadge(latest.status)}</div><p class="muted small-copy">Submitted ${new Date(latest.requested_at).toLocaleString()}</p>` : emptyState("Nothing here yet", "Your parking requests will show up here.")}</aside></section>
    <section class="section-block next-step"><div><span class="eyebrow">QUICK ACCESS</span><h2>Keep things moving.</h2></div><div class="quick-links"><button data-page="slots"><span>▦</span>Browse slots <b>↗</b></button><button data-page="vehicles"><span>⌑</span>Manage vehicles <b>↗</b></button><button data-page="bookings"><span>≡</span>Track requests <b>↗</b></button></div></section>`);
}

async function renderSlots() {
  const [slotResponse, vehicleResponse] = await Promise.all([api("/parking-slots"), api("/vehicles")]);
  const slots = slotResponse.slots;
  const vehicles = vehicleResponse.vehicles;
  const filters = `<form id="slotFilterForm" class="filter-row"><label class="search-field"><span>⌕</span><input name="q" placeholder="Search slot or destination" aria-label="Search slots"></label><select name="status" aria-label="Filter by status"><option value="">All statuses</option><option>AVAILABLE</option><option>OCCUPIED</option><option>RESERVED</option><option>MAINTENANCE</option></select><select name="zone" aria-label="Filter by destination"><option value="">All destinations</option>${[...new Set(slots.map((slot) => slot.zone))].sort().map((zone) => `<option>${escapeHTML(zone)}</option>`).join("")}</select><button class="button button-outline" type="submit">Apply filters</button></form>`;
  const groups = [...new Set(slots.map((slot) => slot.zone))].sort().map((zone) => `<section class="zone-group"><div class="zone-heading"><h3>${escapeHTML(zone)}</h3><span>${slots.filter((slot) => slot.zone === zone).length} spaces</span></div><div class="slot-grid">${slots.filter((slot) => slot.zone === zone).map((slot) => `<button class="slot-tile ${slot.status === "AVAILABLE" && !slot.has_pending_request ? "slot-free" : "slot-unavailable"} ${slot.has_pending_request ? "slot-request-pending" : ""} ${state.selectedSlot?.id === slot.id ? "slot-selected" : ""}" data-slot-id="${slot.id}" data-hourly-rate="${slot.hourly_rate}" ${slot.status !== "AVAILABLE" || slot.has_pending_request ? "disabled" : ""}><span class="slot-icon">P</span><strong>${escapeHTML(slot.slot_number)}</strong><small>${escapeHTML(slot.slot_type)} · ${formatRupees(slot.hourly_rate)}/hr · ${slot.has_pending_request ? "REQUEST PENDING" : escapeHTML(slot.status)}</small></button>`).join("")}</div></section>`).join("");
  const selection = state.selectedSlot ? bookingForm(state.selectedSlot, vehicles) : `<div class="selection-hint">Choose an available space to book instantly. <button class="text-button" data-page="vehicles">${vehicles.length ? "Manage vehicles ↗" : "Add a vehicle first ↗"}</button></div>`;
  setPage("slots", `<section class="page-intro"><div><h2>Find a space that fits.</h2><p>Choose a duration, confirm the demo payment, and your available space is allocated instantly.</p></div><div class="legend"><span><i class="legend-dot available"></i>Available</span><span><i class="legend-dot reserved"></i>Reserved</span><span><i class="legend-dot occupied"></i>Occupied</span><span><i class="legend-dot maintenance"></i>Maintenance</span></div></section>${filters}<div id="slotResults">${groups || emptyState("No parking spaces yet", "There are no spaces to show right now.")}</div><div id="slotSelection">${selection}</div>`);
}

async function renderVehicles() {
  const { vehicles } = await api("/vehicles");
  const cards = vehicles.map((vehicle) => `<article class="vehicle-row"><div class="vehicle-symbol">${vehicle.vehicle_type === "BIKE" ? "⌁" : "▰"}</div><div class="vehicle-info"><span class="eyebrow">${escapeHTML(vehicle.vehicle_type)}</span><h3>${escapeHTML(vehicle.make)} ${escapeHTML(vehicle.model)}</h3><p>${escapeHTML(vehicle.registration_number)}</p></div><button class="icon-button danger" data-action="delete-vehicle" data-id="${vehicle.id}" aria-label="Remove ${escapeHTML(vehicle.registration_number)}" title="Remove vehicle">×</button></article>`).join("");
  setPage("vehicles", `<section class="page-intro"><div><h2>Vehicles you bring.</h2><p>Add vehicles before requesting a parking space.</p></div><span class="count-chip">${vehicles.length} registered</span></section><div class="vehicle-layout"><section class="vehicle-list">${cards || emptyState("No vehicles registered", "Add your first vehicle to request a parking space.")}</section><form id="vehicleForm" class="form-panel"><span class="eyebrow">ADD VEHICLE</span><h2>Register a vehicle</h2><label>Registration number<input name="registrationNumber" placeholder="e.g. ABC 1234" required maxlength="20"></label><div class="form-two"><label>Make<input name="make" placeholder="Honda" required maxlength="60"></label><label>Model<input name="model" placeholder="City" required maxlength="60"></label></div><label>Vehicle type<select name="vehicleType"><option>CAR</option><option>BIKE</option><option>SUV</option><option>OTHER</option></select></label><button class="button button-primary wide" type="submit">Save vehicle <span>↗</span></button></form></div>`);
}

async function renderBookings() {
  const [{ requests }, { allocations }] = await Promise.all([api("/parking-requests"), api("/allocations")]);
  const requestRows = requests.map((request) => `<article class="record-row"><div class="record-leading"><span class="record-index">R${String(request.id).padStart(3, "0")}</span><div><strong>${escapeHTML(request.slot_number)} <span class="muted">· ${escapeHTML(request.zone)}</span></strong><small>${escapeHTML(request.registration_number)} · ${new Date(request.requested_at).toLocaleDateString()}${request.total_amount ? ` · ${request.duration_hours}h · ${formatRupees(request.total_amount)} demo paid` : ""}</small></div></div><div class="record-actions">${statusBadge(request.status)}</div></article>`).join("");
  const allocationRows = allocations.map((allocation) => `<article class="record-row"><div class="record-leading"><span class="record-index allocation-index">A${String(allocation.id).padStart(3, "0")}</span><div><strong>${escapeHTML(allocation.slot_number)} <span class="muted">· ${escapeHTML(allocation.zone)}</span></strong><small>${escapeHTML(allocation.registration_number)} · ${new Date(allocation.allocated_at).toLocaleDateString()} · ${allocation.duration_hours}h at ${formatRupees(allocation.hourly_rate)}/hr = ${formatRupees(allocation.total_amount)} (${allocation.payment_status === "DEMO_PAID" ? "demo paid" : "unpaid"})</small></div></div><div class="record-actions">${statusBadge(allocation.status)}${allocation.status === "ACTIVE" ? `<button class="button button-quiet" data-action="cancel-allocation" data-id="${allocation.id}">Cancel allocation</button>` : ""}</div></article>`).join("");
  setPage("bookings", `<section class="page-intro"><div><h2>Bookings and payments.</h2><p>Spaces are allocated automatically after demo checkout. Rates are charged by the hour.</p></div><button class="button button-outline" data-page="slots">Book parking ↗</button></section><section class="section-block list-section"><div class="section-heading"><div><span class="eyebrow">BOOKING HISTORY</span><h2>Parking requests <span class="heading-count">${requests.length}</span></h2></div></div>${requestRows || emptyState("No bookings yet", "Choose a destination and book your first space.", '<button class="button button-outline" data-page="slots">Browse available spaces</button>')}</section><section class="section-block list-section"><div class="section-heading"><div><span class="eyebrow">YOUR ALLOCATIONS</span><h2>Allocated spaces <span class="heading-count">${allocations.length}</span></h2></div></div>${allocationRows || emptyState("No allocations yet", "Completed bookings will appear here.")}</section>`);
}

async function renderProfile() {
  const { user } = await api("/users/me");
  setPage("profile", `<section class="page-intro"><div><h2>Make it yours.</h2><p>Update the name connected to your ParkFlow account.</p></div></section><form id="profileForm" class="form-panel profile-form"><div class="profile-avatar-large">${escapeHTML(user.name.charAt(0).toUpperCase())}</div><span class="eyebrow">ACCOUNT PROFILE</span><h2>${escapeHTML(user.email)}</h2><label>Full name<input name="name" value="${escapeHTML(user.name)}" required maxlength="100"></label><label>Email address<input value="${escapeHTML(user.email)}" disabled></label><label>Account role<input value="${escapeHTML(user.role)}" disabled></label><button class="button button-primary" type="submit">Save changes <span>↗</span></button></form>`);
}

async function renderAdminDashboard() {
  const stats = await api("/admin/dashboard");
  const { requests } = await api("/parking-requests");
  const recent = requests.filter((item) => item.status === "PENDING").slice(0, 4).map((item) => `<div class="queue-row"><span class="queue-slot">${escapeHTML(item.slot_number)}</span><div><strong>${escapeHTML(item.user_name)}</strong><small>${escapeHTML(item.registration_number)} · ${new Date(item.requested_at).toLocaleDateString()}</small></div>${statusBadge(item.status)}</div>`).join("");
  const totalSlots = Number(stats.totalSlots || 0);
  const occupancy = totalSlots ? Math.round(((Number(stats.occupiedSlots || 0) + Number(stats.reservedSlots || 0)) / totalSlots) * 100) : 0;
  setPage("admin-dashboard", `<section class="welcome-row"><div><span class="eyebrow">PARKING OPERATIONS</span><h2>Bookings at a glance.</h2><p>Automatic allocations, hourly rates, and recorded demo revenue.</p></div><button class="button button-primary" data-page="admin-allocations">View bookings <span>↗</span></button></section><section class="stat-grid admin-stat-grid">${statTile("Demo revenue", formatRupees(stats.totalRevenue), "green", `${stats.paidBookings} demo-paid bookings · no real charges`)}${statTile("Total spaces", stats.totalSlots, "green", "Across all destinations")}${statTile("Available", stats.availableSlots, "mint", "Open for bookings")}${statTile("Occupied", stats.occupiedSlots, "coral", "In active use")}${statTile("Reserved", stats.reservedSlots, "amber", `${stats.maintenanceSlots} in maintenance`)}${statTile("Registered users", stats.totalUsers, "blue", "User accounts")}${statTile("Pending requests", stats.pendingRequests, "amber", "Legacy requests only")}</section><section class="dashboard-columns admin-columns"><div class="section-block"><div class="section-heading"><div><span class="eyebrow">LOT UTILIZATION</span><h2>Space at a glance</h2></div><button class="text-button" data-page="admin-slots">Manage spaces ↗</button></div><div class="utilization"><div class="utilization-copy"><strong>${occupancy}%</strong><span>occupied or reserved</span></div><div class="utilization-track"><span style="width:${occupancy}%"></span></div><div class="utilization-legend"><span><i class="legend-dot occupied"></i>${stats.occupiedSlots} occupied</span><span><i class="legend-dot reserved"></i>${stats.reservedSlots} reserved</span><span><i class="legend-dot available"></i>${stats.availableSlots} available</span></div></div></div><aside class="section-block"><div class="section-heading"><div><span class="eyebrow">LEGACY REQUESTS</span><h2>Needs review</h2></div><span class="count-chip">${stats.pendingRequests} pending</span></div>${recent || emptyState("No pending requests", "New bookings are automatically allocated.")}</aside></section><section class="section-block next-step"><div><span class="eyebrow">OPERATIONS</span><h2>Go straight to the work.</h2></div><div class="quick-links"><button data-page="admin-slots"><span>⊞</span>Manage spaces <b>↗</b></button><button data-page="admin-users"><span>♙</span>Browse users <b>↗</b></button><button data-page="admin-allocations"><span>↔</span>View bookings <b>↗</b></button></div></section>`);
}

async function renderAdminSlots() {
  const { slots } = await api("/parking-slots");
  const rows = slots.map((slot) => `<form class="admin-slot-row" data-slot-form="${slot.id}"><div class="slot-identity"><strong>${escapeHTML(slot.slot_number)}</strong><small>${escapeHTML(slot.zone)} · ${escapeHTML(slot.slot_type)}</small></div><label>Slot<input name="slotNumber" value="${escapeHTML(slot.slot_number)}" required maxlength="10"></label><label>Destination<input name="zone" value="${escapeHTML(slot.zone)}" required maxlength="50"></label><label>Status<select name="status">${["AVAILABLE", "OCCUPIED", "RESERVED", "MAINTENANCE"].map((status) => `<option ${slot.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label><button class="button button-outline" type="submit">Save</button><button class="icon-button danger" data-action="delete-slot" data-id="${slot.id}" type="button" aria-label="Delete ${escapeHTML(slot.slot_number)}">×</button></form>`).join("");
  setPage("admin-slots", `<section class="page-intro"><div><h2>The whole lot, under control.</h2><p>Add new spaces or update the state of an existing one.</p></div><span class="count-chip">${slots.length} spaces</span></section><form id="addSlotForm" class="form-panel add-slot-form"><span class="eyebrow">ADD A PARKING SPACE</span><div class="add-slot-fields"><label>Slot number<input name="slotNumber" placeholder="C2" required maxlength="10"></label><label>Destination<input name="zone" placeholder="Restaurant, hotel or mall" required maxlength="50"></label><label>Space type<select name="slotType"><option>CAR</option><option>BIKE</option><option>ACCESSIBLE</option></select></label><button class="button button-primary" type="submit">Add space +</button></div></form><section class="section-block table-section"><div class="section-heading"><div><span class="eyebrow">SPACE INVENTORY</span><h2>Parking spaces</h2></div></div><div class="admin-slot-list">${rows || emptyState("No parking spaces", "Add a space above to get started.")}</div></section>`);
}

async function renderAdminUsers() {
  const [{ users }, { vehicles }] = await Promise.all([api("/users"), api("/admin/vehicles")]);
  const userRows = users.map((user) => `<article class="directory-row"><div class="user-avatar">${escapeHTML(user.name.charAt(0).toUpperCase())}</div><div class="directory-person"><strong>${escapeHTML(user.name)}</strong><small>${escapeHTML(user.email)}</small></div><span class="role-label">${escapeHTML(user.role)}</span><span class="directory-count">${user.vehicle_count} vehicles</span><span class="muted">Joined ${new Date(user.created_at).toLocaleDateString()}</span></article>`).join("");
  const vehicleRows = vehicles.map((vehicle) => `<article class="record-row"><div class="record-leading"><span class="vehicle-symbol compact">${vehicle.vehicle_type === "BIKE" ? "⌁" : "▰"}</span><div><strong>${escapeHTML(vehicle.make)} ${escapeHTML(vehicle.model)} <span class="muted">· ${escapeHTML(vehicle.registration_number)}</span></strong><small>${escapeHTML(vehicle.user_name)} · ${escapeHTML(vehicle.user_email)}</small></div></div>${statusBadge(vehicle.vehicle_type)}</article>`).join("");
  setPage("admin-users", `<section class="page-intro"><div><h2>People and their vehicles.</h2><p>Accounts are read-only here; users manage their own profile and vehicles.</p></div><span class="count-chip">${users.length} users</span></section><section class="section-block table-section"><div class="section-heading"><div><span class="eyebrow">ACCOUNT DIRECTORY</span><h2>Registered users</h2></div></div><div class="directory-list">${userRows || emptyState("No registered users", "New accounts will appear here.")}</div></section><section class="section-block table-section"><div class="section-heading"><div><span class="eyebrow">VEHICLE DIRECTORY</span><h2>Registered vehicles <span class="heading-count">${vehicles.length}</span></h2></div></div>${vehicleRows || emptyState("No vehicles registered", "User vehicles will appear here.")}</section>`);
}

async function renderAdminRequests() {
  const [{ requests }, { slots }] = await Promise.all([api("/parking-requests"), api("/parking-slots?status=AVAILABLE")]);
  const pending = requests.filter((request) => request.status === "PENDING");
  const rows = pending.map((request) => `<article class="review-card"><div class="review-top"><div class="record-leading"><span class="record-index">R${String(request.id).padStart(3, "0")}</span><div><strong>${escapeHTML(request.user_name)}</strong><small>${escapeHTML(request.user_email)} · ${escapeHTML(request.registration_number)}</small></div></div>${statusBadge(request.status)}</div><div class="review-space"><span><strong>${escapeHTML(request.slot_number)}</strong> · Zone ${escapeHTML(request.zone)}</span><small>Requested ${new Date(request.requested_at).toLocaleString()}</small></div><div class="review-actions"><label>Assign space<select name="slotId" form="approve-${request.id}">${slots.map((slot) => `<option value="${slot.id}" ${slot.id === request.slot_id ? "selected" : ""}>${escapeHTML(slot.slot_number)} · Zone ${escapeHTML(slot.zone)}</option>`).join("")}</select></label><form id="approve-${request.id}" data-approve-form="${request.id}"><button class="button button-primary" type="submit" ${slots.length ? "" : "disabled"}>Approve request</button></form><button class="button button-outline" data-action="reject-request" data-id="${request.id}">Reject</button></div></article>`).join("");
  const history = requests.filter((request) => request.status !== "PENDING").map((request) => `<article class="record-row"><div class="record-leading"><span class="record-index">R${String(request.id).padStart(3, "0")}</span><div><strong>${escapeHTML(request.user_name)} · ${escapeHTML(request.slot_number)}</strong><small>${escapeHTML(request.registration_number)} · ${new Date(request.requested_at).toLocaleDateString()}</small></div></div>${statusBadge(request.status)}</article>`).join("");
  setPage("admin-requests", `<section class="page-intro"><div><h2>Good decisions, made visible.</h2><p>Approval reserves the selected space; rejection returns the request to the user.</p></div><span class="count-chip">${pending.length} awaiting review</span></section><section class="review-list">${rows || emptyState("No requests waiting", "The review queue is all caught up.")}</section><section class="section-block table-section"><div class="section-heading"><div><span class="eyebrow">RECENT DECISIONS</span><h2>Request history</h2></div></div>${history || emptyState("No decisions yet", "Reviewed requests will be listed here.")}</section>`);
}

async function renderAdminAllocations() {
  const [{ allocations }, { slots }] = await Promise.all([api("/allocations"), api("/parking-slots?status=AVAILABLE")]);
  const rows = allocations.map((allocation) => `<article class="admin-allocation-row"><div class="record-leading"><span class="record-index allocation-index">A${String(allocation.id).padStart(3, "0")}</span><div><strong>${escapeHTML(allocation.user_name)} · ${escapeHTML(allocation.slot_number)}</strong><small>${escapeHTML(allocation.user_email)} · ${escapeHTML(allocation.registration_number)} · ${allocation.duration_hours}h · ${formatRupees(allocation.total_amount)} ${allocation.payment_status === "DEMO_PAID" ? "demo paid" : "unpaid"} · ${new Date(allocation.allocated_at).toLocaleDateString()}</small></div></div><div class="record-actions">${statusBadge(allocation.status)}${allocation.status === "ACTIVE" ? `<form class="reassign-form" data-reassign-form="${allocation.id}"><select name="slotId" aria-label="Reassign to space">${slots.map((slot) => `<option value="${slot.id}">${escapeHTML(slot.slot_number)} · ${escapeHTML(slot.zone)}</option>`).join("")}</select><button class="button button-outline" type="submit" ${slots.length ? "" : "disabled"}>Reassign</button></form>` : ""}</div></article>`).join("");
  setPage("admin-allocations", `<section class="page-intro"><div><h2>Bookings and revenue.</h2><p>Revenue includes simulated demo payments only; no real charges are processed.</p></div><span class="count-chip">${formatRupees(allocations.filter((item) => item.payment_status === "DEMO_PAID" && item.status !== "CANCELLED").reduce((total, item) => total + Number(item.total_amount), 0))} recorded demo revenue</span></section><section class="section-block table-section"><div class="section-heading"><div><span class="eyebrow">ALLOCATION REGISTER</span><h2>All bookings</h2></div></div>${rows || emptyState("No bookings yet", "Completed user checkouts will appear here.")}</section>`);
}

async function signIn(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  submit.dataset.originalText = submit.textContent;
  submit.textContent = "Signing in…";
  document.getElementById("authError").hidden = true;
  try {
    const result = await api("/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    state.token = result.token;
    state.user = result.user;
    localStorage.setItem("parkflow_token", result.token);
    form.reset();
    showApp();
  } catch (error) {
    const message = document.getElementById("authError");
    message.textContent = error.message;
    message.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = submit.dataset.originalText || "Sign in";
  }
}

async function register(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  submit.textContent = "Creating account…";
  document.getElementById("authError").hidden = true;
  try {
    const result = await api("/auth/register", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    state.token = result.token;
    state.user = result.user;
    localStorage.setItem("parkflow_token", result.token);
    form.reset();
    showApp();
    toast("Your account is ready.");
  } catch (error) {
    const message = document.getElementById("authError");
    message.textContent = error.message;
    message.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = "Create account ↗";
  }
}

async function signOut(notify = true) {
  if (state.token) await api("/auth/logout", { method: "POST" }).catch(() => {});
  localStorage.removeItem("parkflow_token");
  state.token = null;
  state.user = null;
  state.selectedSlot = null;
  showAuth();
  if (notify) toast("You’re signed out.");
}

async function submitForm(event) {
  const form = event.target;
  if (form.id === "loginForm") return signIn(event);
  if (form.id === "registerForm") return register(event);
  if (form.id === "slotFilterForm") {
    event.preventDefault();
    const filters = new URLSearchParams(new FormData(form));
    const query = filters.toString();
    const results = document.getElementById("slotResults");
    results.innerHTML = '<div class="loading-state"><span class="spinner"></span>Searching spaces…</div>';
    try {
      const { slots } = await api(`/parking-slots?${query}`);
      const groups = [...new Set(slots.map((slot) => slot.zone))].sort().map((zone) => `<section class="zone-group"><div class="zone-heading"><h3>${escapeHTML(zone)}</h3><span>${slots.filter((slot) => slot.zone === zone).length} spaces</span></div><div class="slot-grid">${slots.filter((slot) => slot.zone === zone).map((slot) => `<button class="slot-tile ${slot.status === "AVAILABLE" && !slot.has_pending_request ? "slot-free" : "slot-unavailable"} ${slot.has_pending_request ? "slot-request-pending" : ""}" data-slot-id="${slot.id}" data-hourly-rate="${slot.hourly_rate}" ${slot.status !== "AVAILABLE" || slot.has_pending_request ? "disabled" : ""}><span class="slot-icon">P</span><strong>${escapeHTML(slot.slot_number)}</strong><small>${escapeHTML(slot.slot_type)} · ${formatRupees(slot.hourly_rate)}/hr · ${slot.has_pending_request ? "REQUEST PENDING" : escapeHTML(slot.status)}</small></button>`).join("")}</div></section>`).join("");
      if (results) results.innerHTML = groups || emptyState("No matching spaces", "Try another search or filter.");
    } catch (error) { toast(error.message, "error"); }
    return;
  }
  if (form.id === "requestForm") {
    event.preventDefault();
    try {
      const result = await api("/parking-requests", { method: "POST", body: JSON.stringify({
        slotId: state.selectedSlot.id,
        vehicleId: Number(new FormData(form).get("vehicleId")),
        durationHours: Number(new FormData(form).get("durationHours"))
      }) });
      state.selectedSlot = null;
      toast(`${formatRupees(result.request.total_amount)} demo payment recorded. Your space is booked.`);
      navigate("bookings");
    } catch (error) { toast(error.message, "error"); }
    return;
  }
  if (form.id === "vehicleForm") {
    event.preventDefault();
    try {
      await api("/vehicles", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      toast("Vehicle added.");
      navigate("vehicles");
    } catch (error) { toast(error.message, "error"); }
    return;
  }
  if (form.id === "profileForm") {
    event.preventDefault();
    try {
      const result = await api("/users/me", { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      state.user = result.user;
      document.getElementById("userName").textContent = state.user.name;
      document.getElementById("userAvatar").textContent = state.user.name.charAt(0).toUpperCase();
      toast("Profile updated.");
      navigate("profile");
    } catch (error) { toast(error.message, "error"); }
    return;
  }
  if (form.id === "addSlotForm") {
    event.preventDefault();
    try {
      await api("/parking-slots", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      toast("Parking space added.");
      navigate("admin-slots");
    } catch (error) { toast(error.message, "error"); }
    return;
  }
  if (form.matches("[data-slot-form]")) {
    event.preventDefault();
    try {
      await api(`/parking-slots/${form.dataset.slotForm}`, { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      toast("Parking space updated.");
      navigate("admin-slots");
    } catch (error) { toast(error.message, "error"); }
    return;
  }
  if (form.matches("[data-approve-form]")) {
    event.preventDefault();
    const slotId = form.parentElement.querySelector("select[name=slotId]").value;
    try {
      await api(`/admin/parking-requests/${form.dataset.approveForm}/approve`, { method: "POST", body: JSON.stringify({ slotId: Number(slotId) }) });
      toast("Request approved. Space reserved.");
      navigate("admin-requests");
    } catch (error) { toast(error.message, "error"); }
    return;
  }
  if (form.matches("[data-reassign-form]")) {
    event.preventDefault();
    try {
      await api(`/admin/allocations/${form.dataset.reassignForm}/slot`, { method: "PATCH", body: JSON.stringify({ slotId: Number(new FormData(form).get("slotId")) }) });
      toast("Allocation reassigned.");
      navigate("admin-allocations");
    } catch (error) { toast(error.message, "error"); }
  }
}

async function handleAction(action, id, button) {
  try {
    if (action === "delete-vehicle") await api(`/vehicles/${id}`, { method: "DELETE" });
    if (action === "cancel-request") await api(`/parking-requests/${id}`, { method: "DELETE" });
    if (action === "cancel-allocation") await api(`/allocations/${id}/cancel`, { method: "POST" });
    if (action === "delete-slot") await api(`/parking-slots/${id}`, { method: "DELETE" });
    if (action === "reject-request") await api(`/admin/parking-requests/${id}/reject`, { method: "POST", body: "{}" });
    const messages = { "delete-vehicle": "Vehicle removed.", "cancel-request": "Request cancelled.", "cancel-allocation": "Allocation cancelled and space released.", "delete-slot": "Parking space deleted.", "reject-request": "Request rejected." };
    toast(messages[action] || "Updated.");
    navigate(state.page);
  } catch (error) { toast(error.message, "error"); }
}

document.getElementById("showLogin").addEventListener("click", () => showAuth("login"));
document.getElementById("showRegister").addEventListener("click", () => showAuth("register"));
document.getElementById("loginForm").addEventListener("submit", signIn);
document.getElementById("registerForm").addEventListener("submit", register);
document.getElementById("logoutButton").addEventListener("click", () => signOut());
document.getElementById("mainNav").addEventListener("click", (event) => {
  const item = event.target.closest("[data-page]");
  if (item) navigate(item.dataset.page);
});
document.getElementById("adminNav").addEventListener("click", (event) => {
  const item = event.target.closest("[data-page]");
  if (item) navigate(item.dataset.page);
});
document.getElementById("pageContent").addEventListener("click", (event) => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) { navigate(pageButton.dataset.page); return; }
  const slotButton = event.target.closest("[data-slot-id]");
  if (slotButton && !slotButton.disabled) {
    state.selectedSlot = { id: Number(slotButton.dataset.slotId), slot_number: slotButton.querySelector("strong").textContent, zone: slotButton.closest(".zone-group").querySelector("h3").textContent.replace("Zone ", ""), hourly_rate: Number(slotButton.dataset.hourlyRate) };
    document.querySelectorAll(".slot-tile").forEach((item) => item.classList.toggle("slot-selected", item === slotButton));
    const selection = document.getElementById("slotSelection");
    api("/vehicles").then(({ vehicles }) => {
      selection.innerHTML = vehicles.length ? bookingForm(state.selectedSlot, vehicles) : `<div class="selection-hint">Add a vehicle before booking this space. <button class="text-button" data-page="vehicles">Add a vehicle ↗</button></div>`;
    }).catch((error) => toast(error.message, "error"));
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (actionButton?.dataset.action === "retry") { navigate(actionButton.dataset.page); return; }
  if (actionButton) handleAction(actionButton.dataset.action, actionButton.dataset.id, actionButton);
});
document.getElementById("pageContent").addEventListener("submit", submitForm);
document.getElementById("pageContent").addEventListener("change", (event) => {
  if (event.target.name !== "durationHours") return;
  const form = event.target.closest("#requestForm");
  if (!form) return;
  const total = Number(form.dataset.hourlyRate) * Number(event.target.value);
  form.querySelector("[data-booking-total]").textContent = formatRupees(total);
  form.querySelector('button[type="submit"]').textContent = `Pay ${formatRupees(total)} (demo) & book`;
});

document.addEventListener("DOMContentLoaded", async () => {
  if (!state.token) { showAuth(); return; }
  try {
    const { user } = await api("/auth/me");
    state.user = user;
    showApp();
  } catch { showAuth(); }
});
