const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = process.env.PORT || 3000;

// Set up middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('public'));
app.use(session({ secret: 'your_secret_key', resave: false, saveUninitialized: true }));

// Set up EJS for templating
app.set('view engine', 'ejs');

// Initialize SQLite3 database
const db = new sqlite3.Database('./database.db');

// Create tables and insert items
db.serialize(() => {

    // Drop items table if it exists
    db.run(`DROP TABLE IF EXISTS items`);

    // Create items table with the correct schema
    db.run(`CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        value TEXT NOT NULL
    )`);

    // Insert sample items
    const items = [
        { id: 1, name: 'Flag', price: 20, value: 'TCTF{real_flag_here}' },
        { id: 2, name: 'T-shirt', price: 15, value: 'TCTF{buy_the_flag_for_flag}' },
        { id: 3, name: 'Mug', price: 10, value: 'TCTF{buy_the_flag_for_flag}' },
        { id: 4, name: 'Notebook', price: 5, value: 'TCTF{buy_the_flag_for_flag}' },
        { id: 5, name: 'Pen', price: 2, value: 'TCTF{buy_the_flag_for_flag}' },
        { id: 6, name: 'Fake Flag', price: 0, value: 'TCTF{f4k3_flag}' }
    ];

    // items.forEach(item => {
    //     db.run('INSERT INTO items (name, price, value) VALUES (?, ?, ?)', [item.name, item.price, item.value]);
    // });

    items.forEach(item => {
        db.get('SELECT * FROM items WHERE name = ?', [item.name], (err, row) => {
            if (!row) {
                db.run('INSERT INTO items (name, price, value) VALUES (?, ?, ?)', [item.name, item.price, item.value]);
            }
        });
    });

    // Create users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )`)

    // Add 'balance' column if not exists
    db.run(`ALTER TABLE users ADD COLUMN balance INTEGER DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column name: balance')) {
            console.error('Error adding column:', err);
        }
    });

    // Create purchases table
    db.run(`CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        purchase_date TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (item_id) REFERENCES items(id)
    )`);

    // Create coupons table
    db.run(`CREATE TABLE IF NOT EXISTS coupons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        discount INTEGER NOT NULL
    )`);

    // Insert sample coupons if they don't exist
    db.get('SELECT * FROM coupons WHERE code = "FREE10DOLLARS"', (err, row) => {
        if (!row) {
            db.run('INSERT INTO coupons (code, discount) VALUES (?, ?)', ['FREE10DOLLARS', 10]);
        }
    });

    // Create coupon_redemptions table
    db.run(`CREATE TABLE IF NOT EXISTS coupon_redemptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        coupon_id INTEGER NOT NULL,
        redemption_date TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (coupon_id) REFERENCES coupons(id),
        UNIQUE(user_id, coupon_id)
    )`);
});

// Routes
app.get('/', (req, res) => {
    const loggedIn = !!req.session.userId;
    res.render('index', { loggedIn });
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) return res.send('Error occurred');
        if (!user) return res.send('Invalid username or password');
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) return res.send('Error occurred');
            if (isMatch) {
                req.session.userId = user.id;
                res.redirect(`/items`);
            } else {
                res.send('Invalid username or password');
            }
        });
    });
});

app.get('/signup', (req, res) => {
    const error = req.query.error || null;
    res.render('signup', { error });
});

app.post('/signup', (req, res) => {
    const { username, password } = req.body;

    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) return res.send('Error occurred');

        if (user) {
            return res.send('Username already exists');
        }

        bcrypt.hash(password, 10, (err, hash) => {
            if (err) return res.send('Error occurred');
            db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash], (err) => {
                if (err) return res.send('Error occurred');
                res.redirect('/login');
            });
        });
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.send('Error occurred');
        res.redirect('/');
    });
});

app.get('/items', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    db.get('SELECT balance FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) return res.send('Error occurred');
        const userBalance = user.balance;

        db.all('SELECT * FROM items', (err, items) => {
            if (err) return res.send('Error occurred');
            res.render('items', { items, balance: userBalance });
        });
    });
});

app.post('/purchase', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    const { itemId } = req.body;

    db.get('SELECT * FROM items WHERE id = ?', [itemId], (err, item) => {
        if (err) return res.send('Error occurred');
        if (!item) return res.send('Item not found');

        db.get('SELECT * FROM users WHERE id = ?', [req.session.userId], (err, user) => {
            if (err) return res.send('Error occurred');
            if (user.balance < item.price) return res.send('Insufficient funds');

            const newBalance = user.balance - item.price;
            db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, req.session.userId], (err) => {
                if (err) return res.send('Error occurred');

                const purchaseDate = new Date().toISOString();
                db.run('INSERT INTO purchases (user_id, item_id, purchase_date) VALUES (?, ?, ?)', [req.session.userId, itemId, purchaseDate], (err) => {
                    if (err) return res.send('Error occurred');
                    res.redirect('/items');
                });
            });
        });
    });
});

app.get('/purchases', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    db.all('SELECT p.*, i.name AS item_name, i.price AS item_price FROM purchases p JOIN items i ON p.item_id = i.id WHERE p.user_id = ?', [req.session.userId], (err, purchases) => {
        if (err) return res.send('Error occurred');
        // console.log(purchases)
        console.log('purchases:', purchases)
        flag_purchased = false

        purchases.forEach((purchase) => {
            if (purchase['item_name'] == 'Flag') {
                flag_purchased = true
            }
        })

        if (flag_purchased) {
            return res.render('flag')
        }

        res.render('purchases', { purchases });
    });
});

// Disabled in production.

// app.get('/add-balance', (req, res) => {
//     if (!req.session.userId) {
//         return res.redirect('/login');
//     }

//     db.get('SELECT balance FROM users WHERE id = ?', [req.session.userId], (err, user) => {
//         if (err) return res.send('Error occurred');
//         res.render('add-balance', { balance: user.balance });
//     });
// });

// app.post('/add-balance', (req, res) => {
//     if (!req.session.userId) {
//         return res.redirect('/login');
//     }

//     const { amount } = req.body;

//     if (isNaN(amount) || amount <= 0) {
//         return res.send('Invalid amount');
//     }

//     db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, req.session.userId], (err) => {
//         if (err) return res.send('Error occurred');
//         res.redirect('/items');
//     });
// });

app.get('/redeem-coupon', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    db.get('SELECT balance FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) return res.send('Error occurred');
        res.render('redeem-coupon', { balance: user.balance });
    });
});

app.post('/redeem-coupon', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    const code = req.body.couponCode;
    console.log('Received coupon code:', code);

    db.get('SELECT * FROM coupons WHERE code = ?', [code], (err, coupon) => {
        if (err) {
            console.error('Error fetching coupon:', err);
            return res.send('Error occurred');
        }
        if (!coupon) {
            console.log('Invalid coupon code');
            return res.send('Invalid coupon code');
        }

        console.log('Coupon found:', coupon);

        db.get('SELECT * FROM coupon_redemptions WHERE user_id = ? AND coupon_id = ?', [req.session.userId, coupon.id], (err, redemption) => {
            if (err) {
                console.error('Error checking redemption:', err);
                return res.send('Error occurred');
            }
            if (redemption) {
                console.log('Coupon already redeemed');
                return res.send('Coupon already redeemed');
            }

            db.get('SELECT balance FROM users WHERE id = ?', [req.session.userId], (err, user) => {
                if (err) {
                    console.error('Error fetching user balance:', err);
                    return res.send('Error occurred');
                }

                const newBalance = user.balance + coupon.discount;
                console.log('New balance:', newBalance);

                db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, req.session.userId], (err) => {
                    if (err) {
                        console.error('Error updating user balance:', err);
                        return res.send('Error occurred');
                    }

                    const redemptionDate = new Date().toISOString();
                    db.run('INSERT INTO coupon_redemptions (user_id, coupon_id, redemption_date) VALUES (?, ?, ?)', [req.session.userId, coupon.id, redemptionDate], (err) => {
                        if (err) {
                            console.error('Error inserting redemption:', err);
                            return res.send('Error occurred');
                        }
                        res.redirect('/items');
                    });
                });
            });
        });
    });
});


app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
