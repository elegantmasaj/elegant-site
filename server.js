const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const supabase = createClient(
  'https://zmgrjswtlwsfepigjfen.supabase.co',
  'sb_publishable_eYGD3so8L0-embnp4cGZ-w_cImKoDME'
);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(express.static(__dirname));

const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            adminPassword TEXT DEFAULT 'ElegantAdmin2026*',
            tgUsername TEXT DEFAULT 'kullanici_adiniz',
            tgPhone TEXT DEFAULT '',
            tgPreference TEXT DEFAULT 'username'
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS cities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS ads (
            id TEXT PRIMARY KEY,
            slot INTEGER NOT NULL,
            name TEXT NOT NULL,
            city TEXT NOT NULL,
            phone TEXT NOT NULL,
            image TEXT,
            date TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS payments (
            id TEXT PRIMARY KEY,
            city TEXT NOT NULL,
            slot INTEGER NOT NULL,
            name TEXT NOT NULL,
            period TEXT NOT NULL,
            amount REAL NOT NULL,
            method TEXT DEFAULT 'Tahsilat',
            date TEXT
        )
    `);

    db.run(`ALTER TABLE payments ADD COLUMN date TEXT`, (err) => {
    if (err && !String(err.message).includes('duplicate column name')) {
        console.error('payments date kolon hatası:', err.message);
    }
  });

    db.run(`
        INSERT OR IGNORE INTO settings 
        (id, adminPassword, tgUsername, tgPhone, tgPreference)
        VALUES 
        (1, 'ElegantAdmin2026*', 'kullanici_adiniz', '', 'username')
    `);

    db.run(`INSERT OR IGNORE INTO cities (name) VALUES ('İstanbul')`);
    db.run(`INSERT OR IGNORE INTO cities (name) VALUES ('Ankara')`);
    db.run(`INSERT OR IGNORE INTO cities (name) VALUES ('İzmir')`);
});

function getState(callback) {
    const state = {};

    db.get(`SELECT * FROM settings WHERE id = 1`, [], (err, settings) => {
        if (err) return callback(err);

        state.adminPassword = settings.adminPassword;
        state.tgSettings = {
            username: settings.tgUsername,
            phone: settings.tgPhone,
            preference: settings.tgPreference
        };

        db.all(`SELECT name FROM cities ORDER BY id ASC`, [], (err, cities) => {
            if (err) return callback(err);

            state.cities = cities.map(c => c.name);

            db.all(`SELECT * FROM ads ORDER BY city ASC, slot ASC`, [], (err, ads) => {
                if (err) return callback(err);

                state.ads = ads.map(ad => ({
                    id: ad.id,
                    slot: ad.slot,
                    name: ad.name,
                    city: ad.city,
                    phone: ad.phone,
                    images: ad.image ? [ad.image] : [],
                    date: ad.date
                }));

                db.all(`SELECT * FROM payments`, [], (err, payments) => {
                    if (err) return callback(err);

                    state.payments = payments;
                    callback(null, state);
                });
            });
        });
    });
}

app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'Elegant backend çalışıyor.'
    });
});

app.get('/api/state', (req, res) => {
    getState((err, state) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json(state);
    });
});

app.post('/api/settings/save', (req, res) => {
    const { adminPassword, tgSettings } = req.body;

    db.run(
        `
        UPDATE settings 
        SET adminPassword = ?, tgUsername = ?, tgPhone = ?, tgPreference = ?
        WHERE id = 1
        `,
        [
            adminPassword || 'ElegantAdmin2026*',
            tgSettings?.username || '',
            tgSettings?.phone || '',
            tgSettings?.preference || 'username'
        ],
        function (err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            getState((err, state) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, state });
            });
        }
    );
});

app.post('/api/city/add', (req, res) => {
    const { name } = req.body;
    const cleanName = String(name || '').trim();

    if (!cleanName) {
        return res.status(400).json({ success: false, error: 'Şehir adı boş olamaz.' });
    }

    db.run(
        `INSERT INTO cities (name) VALUES (?)`,
        [cleanName],
        function (err) {
            if (err) {
                return res.status(400).json({ success: false, error: 'Bu şehir zaten ekli olabilir.' });
            }

            getState((err, state) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, state });
            });
        }
    );
});

app.post('/api/city/delete', (req, res) => {
    const { name } = req.body;
    const cleanName = String(name || '').trim();

    db.serialize(() => {
        db.run(`DELETE FROM cities WHERE name = ?`, [cleanName]);
        db.run(`DELETE FROM ads WHERE city = ?`, [cleanName]);
        db.run(`DELETE FROM payments WHERE city = ?`, [cleanName], function (err) {
            if (err) return res.status(500).json({ success: false, error: err.message });

            getState((err, state) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, state });
            });
        });
    });
});

app.post('/api/ad/save', (req, res) => {
    const { id, slot, name, city, phone, images, date } = req.body;

    if (!slot || !name || !city || !phone || !images || images.length === 0) {
        return res.status(400).json({ success: false, error: 'Eksik ilan bilgisi.' });
    }

    const adId = id || '_' + Math.random().toString(36).substr(2, 9);
    const image = images[0];

    db.get(
        `SELECT * FROM ads WHERE slot = ? AND city = ? AND id != ?`,
        [slot, city, adId],
        (err, existing) => {
            if (err) return res.status(500).json({ success: false, error: err.message });

            if (existing) {
                return res.status(400).json({
                    success: false,
                    error: `Seçtiğiniz ${city} Slot ${slot} şu anda ${existing.name} tarafından kullanılıyor.`
                });
            }

            db.run(
                `
                INSERT INTO ads (id, slot, name, city, phone, image, date)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    slot = excluded.slot,
                    name = excluded.name,
                    city = excluded.city,
                    phone = excluded.phone,
                    image = excluded.image,
                    date = ads.date
                `,
                [adId, slot, name, city, phone, image, date || ''],
                function (err) {
                    if (err) return res.status(500).json({ success: false, error: err.message });

                    getState((err, state) => {
                        if (err) return res.status(500).json({ success: false, error: err.message });
                        res.json({ success: true, state });
                    });
                }
            );
        }
    );
});

app.post('/api/ad/delete', (req, res) => {
    const { id } = req.body;

    db.run(`DELETE FROM ads WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ success: false, error: err.message });

        getState((err, state) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, state });
        });
    });
});

app.post('/api/payment/save', (req, res) => {
    const { city, slot, name, period, amount, method, date } = req.body;

    if (!city || !slot || !name || !period || !amount) {
        return res.status(400).json({ success: false, error: 'Eksik tahsilat bilgisi.' });
    }

    const paymentId = 'pay_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    db.run(
        `
        INSERT INTO payments (id, city, slot, name, period, amount, method, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            paymentId,
            city,
            slot,
            name,
            period,
            Number(amount),
            method || 'Tahsilat',
            date || ''
        ],
        function (err) {
            if (err) return res.status(500).json({ success: false, error: err.message });

            getState((err, state) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, state });
            });
        }
    );
});

app.post('/api/payment/delete', (req, res) => {
    const { id } = req.body;

    db.run(`DELETE FROM payments WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ success: false, error: err.message });

        getState((err, state) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, state });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Elegant backend çalışıyor: http://localhost:${PORT}`);
});