CREATE DATABASE IF NOT EXISTS parkflow;
USE parkflow;

CREATE TABLE IF NOT EXISTS users (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NULL,
    password VARCHAR(255) NULL,
    role ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

SET @add_password_hash = IF(
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'password_hash') = 0,
    'ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL',
    'SELECT 1'
);
PREPARE migration_stmt FROM @add_password_hash;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
SET @add_user_created_at = IF(
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'created_at') = 0,
    'ALTER TABLE users ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
    'SELECT 1'
);
PREPARE migration_stmt FROM @add_user_created_at;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
ALTER TABLE users MODIFY COLUMN password VARCHAR(255) NULL;
ALTER TABLE users MODIFY COLUMN role VARCHAR(10) NOT NULL DEFAULT 'USER';
UPDATE users SET role = UPPER(role);
ALTER TABLE users MODIFY COLUMN role ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER';

CREATE TABLE IF NOT EXISTS parking_slots (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    slot_number VARCHAR(10) NOT NULL UNIQUE,
    zone VARCHAR(50) NOT NULL,
    slot_type ENUM('CAR', 'BIKE', 'ACCESSIBLE') NOT NULL DEFAULT 'CAR',
    status ENUM('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE') NOT NULL DEFAULT 'AVAILABLE',
    hourly_rate DECIMAL(8,2) NOT NULL DEFAULT 25.00,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

ALTER TABLE parking_slots MODIFY COLUMN zone VARCHAR(50) NOT NULL;
SET @add_slot_hourly_rate = IF(
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'parking_slots' AND column_name = 'hourly_rate') = 0,
    'ALTER TABLE parking_slots ADD COLUMN hourly_rate DECIMAL(8,2) NOT NULL DEFAULT 25.00',
    'SELECT 1'
);
PREPARE migration_stmt FROM @add_slot_hourly_rate;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
ALTER TABLE parking_slots MODIFY COLUMN status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE';
SET @add_slot_type = IF(
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'parking_slots' AND column_name = 'slot_type') = 0,
    'ALTER TABLE parking_slots ADD COLUMN slot_type ENUM(\'CAR\', \'BIKE\', \'ACCESSIBLE\') NOT NULL DEFAULT \'CAR\'',
    'SELECT 1'
);
PREPARE migration_stmt FROM @add_slot_type;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
UPDATE parking_slots
SET status = CASE LOWER(status)
    WHEN 'available' THEN 'AVAILABLE'
    WHEN 'occupied' THEN 'OCCUPIED'
    WHEN 'reserved' THEN 'RESERVED'
    WHEN 'maintenance' THEN 'MAINTENANCE'
    WHEN 'blocked' THEN 'MAINTENANCE'
    ELSE 'AVAILABLE'
END;
ALTER TABLE parking_slots MODIFY COLUMN status ENUM('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE') NOT NULL DEFAULT 'AVAILABLE';

CREATE TABLE IF NOT EXISTS vehicles (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    registration_number VARCHAR(20) NOT NULL UNIQUE,
    make VARCHAR(60) NOT NULL,
    model VARCHAR(60) NOT NULL,
    vehicle_type ENUM('CAR', 'BIKE', 'SUV', 'OTHER') NOT NULL DEFAULT 'CAR',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_vehicles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS parking_requests (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    vehicle_id INT NOT NULL,
    parking_slot_id INT NOT NULL,
    status ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL,
    reviewed_by INT NULL,
    CONSTRAINT fk_requests_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_requests_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
    CONSTRAINT fk_requests_slot FOREIGN KEY (parking_slot_id) REFERENCES parking_slots(id),
    CONSTRAINT fk_requests_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS allocations (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL UNIQUE,
    user_id INT NOT NULL,
    vehicle_id INT NOT NULL,
    parking_slot_id INT NOT NULL,
    status ENUM('ACTIVE', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'ACTIVE',
    duration_hours TINYINT UNSIGNED NOT NULL DEFAULT 1,
    hourly_rate DECIMAL(8,2) NOT NULL DEFAULT 25.00,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    payment_status ENUM('UNPAID', 'DEMO_PAID') NOT NULL DEFAULT 'UNPAID',
    allocated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    CONSTRAINT fk_allocations_request FOREIGN KEY (request_id) REFERENCES parking_requests(id),
    CONSTRAINT fk_allocations_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_allocations_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
    CONSTRAINT fk_allocations_slot FOREIGN KEY (parking_slot_id) REFERENCES parking_slots(id)
) ENGINE=InnoDB;

SET @add_allocation_duration = IF(
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'allocations' AND column_name = 'duration_hours') = 0,
    'ALTER TABLE allocations ADD COLUMN duration_hours TINYINT UNSIGNED NOT NULL DEFAULT 1',
    'SELECT 1'
);
PREPARE migration_stmt FROM @add_allocation_duration;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
SET @add_allocation_hourly_rate = IF(
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'allocations' AND column_name = 'hourly_rate') = 0,
    'ALTER TABLE allocations ADD COLUMN hourly_rate DECIMAL(8,2) NOT NULL DEFAULT 25.00',
    'SELECT 1'
);
PREPARE migration_stmt FROM @add_allocation_hourly_rate;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
SET @add_allocation_total = IF(
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'allocations' AND column_name = 'total_amount') = 0,
    'ALTER TABLE allocations ADD COLUMN total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00',
    'SELECT 1'
);
PREPARE migration_stmt FROM @add_allocation_total;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
SET @add_allocation_payment_status = IF(
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'allocations' AND column_name = 'payment_status') = 0,
    'ALTER TABLE allocations ADD COLUMN payment_status ENUM(\'UNPAID\', \'DEMO_PAID\') NOT NULL DEFAULT \'UNPAID\'',
    'SELECT 1'
);
PREPARE migration_stmt FROM @add_allocation_payment_status;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

INSERT IGNORE INTO parking_slots (slot_number, zone, slot_type, status) VALUES
    ('DLP1', 'DLF Promenade', 'CAR', 'AVAILABLE'), ('DLP2', 'DLF Promenade', 'CAR', 'OCCUPIED'),
    ('DLP3', 'DLF Promenade', 'CAR', 'RESERVED'), ('DLP4', 'DLF Promenade', 'BIKE', 'AVAILABLE'),
    ('DLE1', 'DLF Emporio', 'CAR', 'AVAILABLE'), ('DLE2', 'DLF Emporio', 'CAR', 'OCCUPIED'),
    ('DLE3', 'DLF Emporio', 'CAR', 'AVAILABLE'), ('DLE4', 'DLF Emporio', 'ACCESSIBLE', 'AVAILABLE'),
    ('AMB1', 'Ambience Mall', 'CAR', 'AVAILABLE'), ('AMB2', 'Ambience Mall', 'CAR', 'AVAILABLE'),
    ('AMB3', 'Ambience Mall', 'BIKE', 'RESERVED'), ('AMB4', 'Ambience Mall', 'CAR', 'AVAILABLE'),
    ('PAC1', 'Pacific Mall', 'CAR', 'AVAILABLE'), ('PAC2', 'Pacific Mall', 'CAR', 'AVAILABLE'),
    ('PAC3', 'Pacific Mall', 'CAR', 'MAINTENANCE'), ('PAC4', 'Pacific Mall', 'BIKE', 'AVAILABLE'),
    ('CHN1', 'The Chanakya', 'CAR', 'OCCUPIED'), ('CHN2', 'The Chanakya', 'CAR', 'AVAILABLE'),
    ('CHN3', 'The Chanakya', 'ACCESSIBLE', 'AVAILABLE'), ('CHN4', 'The Chanakya', 'CAR', 'AVAILABLE'),
    ('VEG1', 'Vegas Mall', 'CAR', 'AVAILABLE'), ('VEG2', 'Vegas Mall', 'CAR', 'RESERVED'),
    ('VEG3', 'Vegas Mall', 'BIKE', 'AVAILABLE'), ('VEG4', 'Vegas Mall', 'CAR', 'OCCUPIED'),
    ('ANS1', 'Ansal Plaza', 'CAR', 'AVAILABLE'), ('ANS2', 'Ansal Plaza', 'CAR', 'AVAILABLE'),
    ('ANS3', 'Ansal Plaza', 'BIKE', 'RESERVED'), ('ANS4', 'Ansal Plaza', 'CAR', 'AVAILABLE'),
    ('MTW1', 'Metro Walk', 'CAR', 'AVAILABLE'), ('MTW2', 'Metro Walk', 'CAR', 'OCCUPIED'),
    ('MTW3', 'Metro Walk', 'ACCESSIBLE', 'AVAILABLE'), ('MTW4', 'Metro Walk', 'CAR', 'AVAILABLE'),
    ('CRR1', 'Cross River Mall', 'CAR', 'AVAILABLE'), ('CRR2', 'Cross River Mall', 'CAR', 'AVAILABLE'),
    ('CRR3', 'Cross River Mall', 'BIKE', 'AVAILABLE'), ('CRR4', 'Cross River Mall', 'CAR', 'MAINTENANCE'),
    ('V3S1', 'V3S Mall', 'CAR', 'AVAILABLE'), ('V3S2', 'V3S Mall', 'CAR', 'RESERVED'),
    ('V3S3', 'V3S Mall', 'CAR', 'AVAILABLE'), ('V3S4', 'V3S Mall', 'BIKE', 'AVAILABLE');
