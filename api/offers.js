import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authHeader = req.headers.authorization;
  let userId = null, userRole = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.id;
      userRole = decoded.role;
    } catch (err) {
      // Token invalid – treat as public for GET requests
    }
  }

  const { action } = req.query;

  // ============================================================
  // LIST OFFERS (Public, Merchant, Admin)
  // ============================================================
  if (action === 'list') {
    const { shop_id } = req.query;

    let query = supabaseAdmin
      .from('offers')
      .select(`
        id,
        shop_id,
        product_id,
        title,
        description,
        image_url,
        old_price,
        offer_price,
        discount_percent,
        expires_at,
        created_at,
        shops:shop_id (
          shop_name,
          image_url
        )
      `)
      .order('created_at', { ascending: false });

    // If shop_id provided, filter by that shop
    if (shop_id) {
      query = query.eq('shop_id', shop_id);
    }

    // For public, only show offers that haven't expired
    if (!userId) {
      query = query.gt('expires_at', new Date().toISOString());
    }

    // If merchant, only show their own shop's offers
    if (userId && userRole === 'merchant') {
      const { data: shop } = await supabaseAdmin
        .from('shops')
        .select('id')
        .eq('merchant_id', userId)
        .single();

      if (shop) {
        query = query.eq('shop_id', shop.id);
      } else {
        return res.status(404).json({ error: 'Shop not found' });
      }
    }

    const { data: offers, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ offers });
  }

  // ============================================================
  // CREATE OFFER (Merchant or Admin)
  // ============================================================
  if (action === 'create') {
    if (!userId || (userRole !== 'merchant' && userRole !== 'admin')) {
      return res.status(403).json({ error: 'Forbidden — Merchant or Admin access only' });
    }

    const {
      shop_id,
      product_id,
      title,
      description,
      image_url,
      old_price,
      offer_price,
      expires_at
    } = req.body;

    if (!title || !old_price || !offer_price || !expires_at) {
      return res.status(400).json({ error: 'Title, old_price, offer_price, and expires_at are required.' });
    }

    // If merchant, verify they own the shop
    if (userRole === 'merchant') {
      const { data: shop } = await supabaseAdmin
        .from('shops')
        .select('id')
        .eq('id', shop_id)
        .eq('merchant_id', userId)
        .single();

      if (!shop) {
        return res.status(403).json({ error: 'You do not own this shop.' });
      }
    }

    // Admin can create for any shop
    const { data: offer, error } = await supabaseAdmin
      .from('offers')
      .insert({
        shop_id,
        product_id: product_id || null,
        title,
        description: description || null,
        image_url: image_url || null,
        old_price,
        offer_price,
        expires_at
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({ success: true, offer });
  }

  // ============================================================
  // UPDATE OFFER (Merchant or Admin)
  // ============================================================
  if (action === 'update') {
    if (!userId || (userRole !== 'merchant' && userRole !== 'admin')) {
      return res.status(403).json({ error: 'Forbidden — Merchant or Admin access only' });
    }

    const {
      offer_id,
      title,
      description,
      image_url,
      old_price,
      offer_price,
      expires_at
    } = req.body;

    if (!offer_id) {
      return res.status(400).json({ error: 'Offer ID required.' });
    }

    // Verify ownership (merchant) or admin access
    if (userRole === 'merchant') {
      const { data: shop } = await supabaseAdmin
        .from('shops')
        .select('id')
        .eq('merchant_id', userId)
        .single();

      if (!shop) {
        return res.status(404).json({ error: 'Shop not found' });
      }

      const { data: offer } = await supabaseAdmin
        .from('offers')
        .select('shop_id')
        .eq('id', offer_id)
        .single();

      if (!offer || offer.shop_id !== shop.id) {
        return res.status(403).json({ error: 'You do not own this offer.' });
      }
    }

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (image_url !== undefined) updates.image_url = image_url;
    if (old_price !== undefined) updates.old_price = old_price;
    if (offer_price !== undefined) updates.offer_price = offer_price;
    if (expires_at !== undefined) updates.expires_at = expires_at;
    updates.updated_at = new Date().toISOString();

    const { data: offer, error } = await supabaseAdmin
      .from('offers')
      .update(updates)
      .eq('id', offer_id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true, offer });
  }

  // ============================================================
  // DELETE OFFER (Merchant or Admin)
  // ============================================================
  if (action === 'delete') {
    if (!userId || (userRole !== 'merchant' && userRole !== 'admin')) {
      return res.status(403).json({ error: 'Forbidden — Merchant or Admin access only' });
    }

    const { offer_id } = req.body;

    if (!offer_id) {
      return res.status(400).json({ error: 'Offer ID required.' });
    }

    // Verify ownership (merchant) or admin access
    if (userRole === 'merchant') {
      const { data: shop } = await supabaseAdmin
        .from('shops')
        .select('id')
        .eq('merchant_id', userId)
        .single();

      if (!shop) {
        return res.status(404).json({ error: 'Shop not found' });
      }

      const { data: offer } = await supabaseAdmin
        .from('offers')
        .select('shop_id')
        .eq('id', offer_id)
        .single();

      if (!offer || offer.shop_id !== shop.id) {
        return res.status(403).json({ error: 'You do not own this offer.' });
      }
    }

    const { error } = await supabaseAdmin
      .from('offers')
      .delete()
      .eq('id', offer_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
