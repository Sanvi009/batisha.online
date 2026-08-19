import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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
  // GLOBAL LIST – All Products (Public)
  // ============================================================
  if (action === 'global-list') {
    const { category_id, limit = 20, offset = 0 } = req.query;

    let query = supabaseAdmin
      .from('products')
      .select(`
        id,
        title,
        description,
        price,
        image_url,
        category_id,
        categories:category_id (name),
        created_at
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (category_id) {
      query = query.eq('category_id', category_id);
    }

    const { data: products, error, count } = await query
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      products,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0),
    });
  }

  // ============================================================
  // MERCHANT IMPORT – Assign a global product to shop
  // ============================================================
  if (action === 'import') {
    if (!userId || userRole !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden — Merchant access only' });
    }

    const { product_id, custom_price } = req.body;

    if (!product_id) {
      return res.status(400).json({ error: 'Product ID required' });
    }

    // Get merchant's shop
    const { data: shop } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', userId)
      .single();

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Check if product exists
    const { data: product } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('id', product_id)
      .single();

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Check if already assigned
    const { data: existing } = await supabaseAdmin
      .from('shop_products')
      .select('id')
      .eq('shop_id', shop.id)
      .eq('product_id', product_id)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Product already assigned to your shop' });
    }

    const { data: shopProduct, error } = await supabaseAdmin
      .from('shop_products')
      .insert({
        shop_id: shop.id,
        product_id,
        custom_price: custom_price || null,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({ success: true, shopProduct });
  }

  // ============================================================
  // MERCHANT CREATE – Create new global product + assign to shop
  // ============================================================
  if (action === 'create') {
    if (!userId || userRole !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden — Merchant access only' });
    }

    const { title, description, price, image_url, category_id } = req.body;

    if (!title || !price) {
      return res.status(400).json({ error: 'Title and price are required' });
    }

    // Get merchant's shop
    const { data: shop } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', userId)
      .single();

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Create global product
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        title,
        description: description || null,
        price,
        image_url: image_url || null,
        category_id: category_id || null,
      })
      .select()
      .single();

    if (productError) {
      return res.status(500).json({ error: productError.message });
    }

    // Assign to merchant's shop
    const { data: shopProduct, error: spError } = await supabaseAdmin
      .from('shop_products')
      .insert({
        shop_id: shop.id,
        product_id: product.id,
        custom_price: null, // use global price
      })
      .select()
      .single();

    if (spError) {
      // Rollback product
      await supabaseAdmin.from('products').delete().eq('id', product.id);
      return res.status(500).json({ error: spError.message });
    }

    return res.status(201).json({
      success: true,
      product,
      shopProduct,
    });
  }

  // ============================================================
  // ADMIN LIST – All products with shop assignments (Admin only)
  // ============================================================
  if (action === 'admin-list') {
    if (!userId || userRole !== 'admin') {
      return res.status(403).json({ error: 'Forbidden — Admin access only' });
    }

    const { limit = 50, offset = 0 } = req.query;

    const { data: products, error, count } = await supabaseAdmin
      .from('products')
      .select(`
        id,
        title,
        description,
        price,
        image_url,
        category_id,
        categories:category_id (name),
        created_at,
        shop_products (
          shop_id,
          shops:shop_id (shop_name)
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      products,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0),
    });
  }

  // ============================================================
  // MERCHANT SHOP LIST – Products assigned to their shop
  // ============================================================
  if (action === 'shop-list') {
    if (!userId || userRole !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden — Merchant access only' });
    }

    const { data: shop } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', userId)
      .single();

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const { data: shopProducts, error } = await supabaseAdmin
      .from('shop_products')
      .select(`
        id,
        custom_price,
        is_visible,
        products:product_id (
          id,
          title,
          description,
          price,
          image_url,
          category_id,
          categories:category_id (name)
        )
      `)
      .eq('shop_id', shop.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ products: shopProducts });
  }

  // ============================================================
  // UPDATE SHOP PRODUCT (Merchant only)
  // ============================================================
  if (action === 'update') {
    if (!userId || userRole !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden — Merchant access only' });
    }

    const { shopProductId, title, description, price, category_id } = req.body;

    if (!shopProductId) {
      return res.status(400).json({ error: 'Shop product ID required' });
    }

    const { data: shop } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', userId)
      .single();

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const { data: sp } = await supabaseAdmin
      .from('shop_products')
      .select('product_id, shop_id')
      .eq('id', shopProductId)
      .eq('shop_id', shop.id)
      .single();

    if (!sp) {
      return res.status(404).json({ error: 'Shop product not found' });
    }

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = price;
    if (category_id !== undefined) updates.category_id = category_id;
    updates.updated_at = new Date().toISOString();

    const { data: updatedProduct, error } = await supabaseAdmin
      .from('products')
      .update(updates)
      .eq('id', sp.product_id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true, product: updatedProduct });
  }

  // ============================================================
  // DELETE SHOP PRODUCT (Merchant only) – unassign from shop
  // ============================================================
  if (action === 'delete') {
    if (!userId || userRole !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden — Merchant access only' });
    }

    const { shopProductId } = req.body;

    if (!shopProductId) {
      return res.status(400).json({ error: 'Shop product ID required' });
    }

    const { data: shop } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', userId)
      .single();

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const { data: sp } = await supabaseAdmin
      .from('shop_products')
      .select('id, shop_id')
      .eq('id', shopProductId)
      .eq('shop_id', shop.id)
      .single();

    if (!sp) {
      return res.status(404).json({ error: 'Shop product not found' });
    }

    const { error } = await supabaseAdmin
      .from('shop_products')
      .delete()
      .eq('id', shopProductId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
