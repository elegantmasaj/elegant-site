const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = 'https://xdhashkodkwiwlfschdv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_u9FBdDWb1blk_VZWaQnBpw_dSxo_oU9'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));

async function ensureDefaults() {
    await supabase.from('settings').upsert({
        id: 1,
        adminpassword: 'ElegantAdmin2026*',
        tgusername: 'kullanici_adiniz',
        tgphone: '',
        tgpreference: 'username'
    }, { onConflict: 'id' });

    await supabase.from('cities').upsert([
        { name: 'İstanbul' },
        { name: 'Ankara' },
        { name: 'İzmir' }
    ], { onConflict: 'name' });
}

async function getState() {
    const { data: settingsRows, error: settingsError } = await supabase
        .from('settings')
        .select('*')
        .eq('id', 1)
        .limit(1);

        const settings = settingsRows?.[0];

    if (settingsError) throw settingsError;

    const { data: cities, error: citiesError } = await supabase
        .from('cities')
        .select('name')
        .order('id', { ascending: true });

    if (citiesError) throw citiesError;

    const { data: ads, error: adsError } = await supabase
        .from('ads')
        .select('*')
        .order('city', { ascending: true })
        .order('slot', { ascending: true });

    if (adsError) throw adsError;

    const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select('*');

    if (paymentsError) throw paymentsError;

    return {
        adminPassword: settings?.adminpassword || 'ElegantAdmin2026*',
        tgSettings: {
            username: settings?.tgusername || 'kullanici_adiniz',
            phone: settings?.tgphone || '',
            preference: settings?.tgpreference || 'username'
        },
        cities: (cities || []).map(c => c.name),
        ads: (ads || []).map(ad => ({
            id: ad.id,
            slot: ad.slot,
            name: ad.name,
            city: ad.city,
            phone: ad.phone,
            images: ad.image ? [ad.image] : [],
            date: ad.date
        })),
        payments: payments || []
    };
}

app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'Elegant backend Supabase ile çalışıyor.'
    });
});

app.get('/api/state', async (req, res) => {
    try {
        const state = await getState();
        res.json(state);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/settings/save', async (req, res) => {
    try {
        const { adminPassword, tgSettings } = req.body;

        const { error } = await supabase.from('settings').upsert({
            id: 1,
            adminpassword: adminPassword || 'ElegantAdmin2026*',
            tgusername: tgSettings?.username || '',
            tgphone: tgSettings?.phone || '',
            tgpreference: tgSettings?.preference || 'username'
        }, { onConflict: 'id' });

        if (error) throw error;

        const state = await getState();
        res.json({ success: true, state });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/city/add', async (req, res) => {
    try {
        const cleanName = String(req.body.name || '').trim();
        if (!cleanName) {
            return res.status(400).json({ success: false, error: 'Şehir adı boş olamaz.' });
        }

        const { error } = await supabase
            .from('cities')
            .insert({ name: cleanName });

        if (error) {
            return res.status(400).json({ success: false, error: 'Bu şehir zaten ekli olabilir.' });
        }

        const state = await getState();
        res.json({ success: true, state });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/city/delete', async (req, res) => {
    try {
        const cleanName = String(req.body.name || '').trim();

        await supabase.from('payments').delete().eq('city', cleanName);
        await supabase.from('ads').delete().eq('city', cleanName);
        await supabase.from('cities').delete().eq('name', cleanName);

        const state = await getState();
        res.json({ success: true, state });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/ad/save', async (req, res) => {
    try {
        const { id, slot, name, city, phone, images, date } = req.body;

        if (!slot || !name || !city || !phone || !images || images.length === 0) {
            return res.status(400).json({ success: false, error: 'Eksik ilan bilgisi.' });
        }

        const adId = id || '_' + Math.random().toString(36).substr(2, 9);
        const image = images[0];

        const { data: existing, error: checkError } = await supabase
            .from('ads')
            .select('*')
            .eq('slot', Number(slot))
            .eq('city', city)
            .neq('id', adId)
            .maybeSingle();

        if (checkError) throw checkError;

        if (existing) {
            return res.status(400).json({
                success: false,
                error: `Seçtiğiniz ${city} Slot ${slot} şu anda ${existing.name} tarafından kullanılıyor.`
            });
        }

        const { data: oldAd } = await supabase
            .from('ads')
            .select('date')
            .eq('id', adId)
            .maybeSingle();

        const finalDate = oldAd?.date || date || '';

        const { error } = await supabase
            .from('ads')
            .upsert({
                id: adId,
                slot: Number(slot),
                name,
                city,
                phone,
                image,
                date: finalDate
            }, { onConflict: 'id' });

        if (error) throw error;

        const state = await getState();
        res.json({ success: true, state });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/ad/delete', async (req, res) => {
    try {
        const { id } = req.body;

        const { error } = await supabase
            .from('ads')
            .delete()
            .eq('id', id);

        if (error) throw error;

        const state = await getState();
        res.json({ success: true, state });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/payment/save', async (req, res) => {
    try {
        const { city, slot, name, period, amount, method, date } = req.body;

        if (!city || !slot || !name || !period || !amount) {
            return res.status(400).json({ success: false, error: 'Eksik tahsilat bilgisi.' });
        }

        const paymentId = 'pay_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

        const { error } = await supabase
            .from('payments')
            .insert({
                id: paymentId,
                city,
                slot: Number(slot),
                name,
                period,
                amount: Number(amount),
                method: method || 'Tahsilat',
                date: date || ''
            });

        if (error) throw error;

        const state = await getState();
        res.json({ success: true, state });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/payment/delete', async (req, res) => {
    try {
        const { id } = req.body;

        const { error } = await supabase
            .from('payments')
            .delete()
            .eq('id', id);

        if (error) throw error;

        const state = await getState();
        res.json({ success: true, state });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

ensureDefaults().then(() => {
    app.listen(PORT, () => {
        console.log(`Elegant backend Supabase ile çalışıyor: http://localhost:${PORT}`);
    });
});