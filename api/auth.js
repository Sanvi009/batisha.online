import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;

  // ============================================================
  // REGISTER (Merchant or User)
  // ============================================================
  if (action === 'register') {
    const { phone, password, full_name, email, role, shop_name, proprietor_name, address, shop_image_url } = req.body;

    if (!phone || !password || !full_name || !role) {
      return res.status(400).json({ error: 'Phone, password, full name, and role are required.' });
    }

    if (role !== 'user' && role !== 'merchant') {
      return res.status(400).json({ error: 'Role must be "user" or "merchant".' });
    }

    // ✅ Check if the SAME role already uses this phone
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('phone, role')
      .eq('phone', phone)
      .eq('role', role)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: `Phone number already registered as a ${role}.` });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert into profiles
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        phone,
        password_hash: hashedPassword,
        role,
        full_name,
        email: email || null,
        is_banned: false,
      })
      .select()
      .single();

    if (profileError) {
      return res.status(500).json({ error: profileError.message });
    }

    // If merchant, also create a shop
    if (role === 'merchant') {
      if (!shop_name || !proprietor_name || !address) {
        // Rollback profile insert if shop details missing
        await supabaseAdmin.from('profiles').delete().eq('id', profile.id);
        return res.status(400).json({ error: 'Shop name, proprietor name, and address are required for merchants.' });
      }

      const { error: shopError } = await supabaseAdmin
        .from('shops')
        .insert({
          merchant_id: profile.id,
          shop_name,
          proprietor_name,
          phone,
          address,
          image_url: shop_image_url || null,
        });

      if (shopError) {
        await supabaseAdmin.from('profiles').delete().eq('id', profile.id);
        return res.status(500).json({ error: shopError.message });
      }
    }

    // If user, create a default address
    if (role === 'user' && address) {
      await supabaseAdmin
        .from('user_addresses')
        .insert({
          user_id: profile.id,
          name: full_name,
          phone,
          address,
        });
    }

    const token = jwt.sign(
      { id: profile.id, phone: profile.phone, role: profile.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      success: true,
      token,
      user: {
        id: profile.id,
        phone: profile.phone,
        full_name: profile.full_name,
        role: profile.role,
        is_banned: profile.is_banned,
      },
    });
  }

  // ============================================================
  // LOGIN (Merchant, User, or Admin)
  // ============================================================
  if (action === 'login') {
    const { phone, password, username } = req.body;

    // === Admin login (username + password from env) ===
    if (username) {
      const adminUsername = process.env.USER_NAME;
      const adminPassword = process.env.USER_PASSWORD;

      if (username === adminUsername && password === adminPassword) {
        let { data: adminProfile } = await supabaseAdmin
          .from('profiles')
          .select('id, phone, role, full_name, is_banned')
          .eq('role', 'admin')
          .maybeSingle();

        if (!adminProfile) {
          const { data: newAdmin, error } = await supabaseAdmin
            .from('profiles')
            .insert({
              phone: 'admin',
              password_hash: await bcrypt.hash(adminPassword, 10),
              role: 'admin',
              full_name: 'Admin',
              is_banned: false,
            })
            .select()
            .single();

          if (error) {
            return res.status(500).json({ error: error.message });
          }
          adminProfile = newAdmin;
        }

        const token = jwt.sign(
          { id: adminProfile.id, phone: adminProfile.phone, role: 'admin' },
          process.env.JWT_SECRET,
          { expiresIn: '7d' }
        );

        return res.status(200).json({
          success: true,
          token,
          user: {
            id: adminProfile.id,
            phone: adminProfile.phone,
            full_name: adminProfile.full_name,
            role: 'admin',
            is_banned: adminProfile.is_banned,
          },
        });
      } else {
        return res.status(401).json({ error: 'Invalid admin credentials.' });
      }
    }

    // === User / Merchant login (phone + password) ===
    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone and password required.' });
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('phone', phone)
      .single();

    if (error || !profile) {
      return res.status(401).json({ error: 'Invalid phone or password.' });
    }

    if (profile.is_banned) {
      return res.status(403).json({
        error: 'Account banned.',
        ban_reason: profile.ban_reason || 'Your account has been banned.',
      });
    }

    const valid = await bcrypt.compare(password, profile.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid phone or password.' });
    }

    const token = jwt.sign(
      { id: profile.id, phone: profile.phone, role: profile.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: profile.id,
        phone: profile.phone,
        full_name: profile.full_name,
        role: profile.role,
        is_banned: profile.is_banned,
      },
    });
  }

  // ============================================================
  // VERIFY TOKEN
  // ============================================================
  if (action === 'verify') {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, phone, full_name, role, is_banned, ban_reason')
        .eq('id', decoded.id)
        .single();

      if (!profile) {
        return res.status(401).json({ error: 'User not found.' });
      }

      if (profile.is_banned) {
        return res.status(403).json({
          error: 'Account banned.',
          ban_reason: profile.ban_reason,
        });
      }

      return res.status(200).json({
        success: true,
        user: profile,
      });
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token.' });
    }
  }

  // ============================================================
  // LOGOUT
  // ============================================================
  if (action === 'logout') {
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Invalid action.' });
}
