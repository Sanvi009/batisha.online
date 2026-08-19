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
  // LIST PRODUCTS FOR A SHOP (Merchant only)
  // ============================================================
  if (action === 'shop-list') {
    if (userRole !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden — Merchant access only' });
    }

    // Get merchant's shop_id
    const { data: shop, error: shopError } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', userId)
      .single();

    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shop.id;

    // Fetch shop_products with product details
    const { data: shopProducts, error: spError } = await supabaseAdmin
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
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false });

    if (spError) {
      return res.status(500).json({ error: spError.message });
    }

    return res.status(200).json({
      products: shopProducts,
    });
  }

  // ============================================================
  // UPDATE A SHOP PRODUCT (Merchant only)
  // ============================================================
  if (action === 'update') {
    if (userRole !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden — Merchant access only' });
    }

    const { shopProductId, title, description, price, category_id } = req.body;

    if (!shopProductId) {
      return res.status(400).json({ error: 'Shop product ID required' });
    }

    // Verify this shop_product belongs to the merchant's shop
    const { data: shop, error: shopError } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', userId)
      .single();

    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const { data: sp, error: spError } = await supabaseAdmin
      .from('shop_products')
      .select('product_id, shop_id')
      .eq('id', shopProductId)
      .eq('shop_id', shop.id)
      .single();

    if (spError || !sp) {
      return res.status(404).json({ error: 'Shop product not found' });
    }

    // Update the product table (global)
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = price;
    if (category_id !== undefined) updates.category_id = category_id;

    const { data: updatedProduct, error: updateError } = await supabaseAdmin
      .from('products')
      .update(updates)
      .eq('id', sp.product_id)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    return res.status(200).json({
      success: true,
      product: updatedProduct,
    });
  }

  // ============================================================
  // DELETE A SHOP PRODUCT (Unassign from shop) — Merchant only
  // ============================================================
  if (action === 'delete') {
    if (userRole !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden — Merchant access only' });
    }

    const { shopProductId } = req.body;

    if (!shopProductId) {
      return res.status(400).json({ error: 'Shop product ID required' });
    }

    // Verify this shop_product belongs to the merchant's shop
    const { data: shop, error: shopError } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', userId)
      .single();

    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const { data: sp, error: spError } = await supabaseAdmin
      .from('shop_products')
      .select('id, shop_id')
      .eq('id', shopProductId)
      .eq('shop_id', shop.id)
      .single();

    if (spError || !sp) {
      return res.status(404).json({ error: 'Shop product not found' });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('shop_products')
      .delete()
      .eq('id', shopProductId);

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }

    return res.status(200).json({
      success: true,
      message: 'Product removed from shop',
    });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
