import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  let userId, userRole;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    userId = decoded.id;
    userRole = decoded.role;
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { action } = req.query;

  // ============================================================
  // GET PROFILE (User or Merchant)
  // ============================================================
  if (action === 'get') {
    // Fetch profile
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, phone, full_name, email, role, is_banned, created_at, updated_at')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // If user, also fetch addresses
    let addresses = [];
    if (userRole === 'user') {
      const { data: addrData, error: addrError } = await supabaseAdmin
        .from('user_addresses')
        .select('id, name, phone, address, created_at, updated_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!addrError) {
        addresses = addrData || [];
      }
    }

    return res.status(200).json({
      profile: {
        id: profile.id,
        phone: profile.phone,
        full_name: profile.full_name,
        email: profile.email,
        role: profile.role,
        is_banned: profile.is_banned,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
      },
      addresses: addresses,
    });
  }

  // ============================================================
  // UPDATE PROFILE (User or Merchant)
  // ============================================================
  if (action === 'update') {
    const { full_name, email, phone } = req.body;

    const updates = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    updates.updated_at = new Date().toISOString();

    const { data: updatedProfile, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select('id, phone, full_name, email, role, updated_at')
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      profile: updatedProfile,
    });
  }

  // ============================================================
  // ADDRESS BOOK (Users only)
  // ============================================================
  if (userRole !== 'user') {
    return res.status(403).json({ error: 'Address book is for users only' });
  }

  // --- LIST ADDRESSES ---
  if (action === 'address-list') {
    const { data: addresses, error } = await supabaseAdmin
      .from('user_addresses')
      .select('id, name, phone, address, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ addresses });
  }

  // --- ADD ADDRESS ---
  if (action === 'address-add') {
    const { name, phone, address } = req.body;

    if (!name || !phone || !address) {
      return res.status(400).json({ error: 'Name, phone, and address are required.' });
    }

    // Check if user already has 5 addresses
    const { count, error: countError } = await supabaseAdmin
      .from('user_addresses')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countError) {
      return res.status(500).json({ error: countError.message });
    }

    if (count >= 5) {
      return res.status(400).json({ error: 'You can have up to 5 addresses only.' });
    }

    const { data: addressData, error } = await supabaseAdmin
      .from('user_addresses')
      .insert({
        user_id: userId,
        name,
        phone,
        address,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({
      success: true,
      address: addressData,
    });
  }

  // --- UPDATE ADDRESS ---
  if (action === 'address-update') {
    const { address_id, name, phone, address } = req.body;

    if (!address_id) {
      return res.status(400).json({ error: 'Address ID required.' });
    }

    // Verify ownership
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('user_addresses')
      .select('id')
      .eq('id', address_id)
      .eq('user_id', userId)
      .single();

    if (checkError || !existing) {
      return res.status(404).json({ error: 'Address not found or does not belong to you.' });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (address !== undefined) updates.address = address;
    updates.updated_at = new Date().toISOString();

    const { data: updatedAddress, error } = await supabaseAdmin
      .from('user_addresses')
      .update(updates)
      .eq('id', address_id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      address: updatedAddress,
    });
  }

  // --- DELETE ADDRESS ---
  if (action === 'address-delete') {
    const { address_id } = req.body;

    if (!address_id) {
      return res.status(400).json({ error: 'Address ID required.' });
    }

    // Verify ownership
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('user_addresses')
      .select('id')
      .eq('id', address_id)
      .eq('user_id', userId)
      .single();

    if (checkError || !existing) {
      return res.status(404).json({ error: 'Address not found or does not belong to you.' });
    }

    const { error } = await supabaseAdmin
      .from('user_addresses')
      .delete()
      .eq('id', address_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
