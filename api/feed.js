import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;

  // ============================================================
  // HOME – PRODUCT GRID (Public)
  // ============================================================
  if (action === 'home') {
    const { shop_id, category_id, limit = 20, offset = 0 } = req.query;

    let query = supabaseAdmin
      .from('shop_products')
      .select(`
        id,
        custom_price,
        is_visible,
        shop_id,
        shops:shop_id (
          shop_name,
          image_url
        ),
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
      .eq('is_visible', true)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    // Filter by shop if provided
    if (shop_id) {
      query = query.eq('shop_id', shop_id);
    }

    // Filter by category if provided
    if (category_id) {
      query = query.eq('products.category_id', category_id);
    }

    const { data: products, error, count } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Format response for frontend
    const formatted = products.map(sp => ({
      shop_product_id: sp.id,
      shop_id: sp.shop_id,
      shop_name: sp.shops?.shop_name || 'Unknown Shop',
      shop_image: sp.shops?.image_url || null,
      product_id: sp.products?.id,
      title: sp.products?.title,
      description: sp.products?.description,
      price: sp.custom_price || sp.products?.price,
      image_url: sp.products?.image_url,
      category: sp.products?.categories?.name || 'Uncategorized',
    }));

    return res.status(200).json({
      products: formatted,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  // ============================================================
  // OFFERS – OFFER GRID (Public)
  // ============================================================
  if (action === 'offers') {
    const { limit = 20, offset = 0 } = req.query;

    const { data: offers, error, count } = await supabaseAdmin
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
        shops:shop_id (
          shop_name,
          image_url
        )
      `)
      .gt('expires_at', new Date().toISOString()) // only active offers
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      offers,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  // ============================================================
  // SHOP – SINGLE SHOP PAGE (Public)
  // ============================================================
  if (action === 'shop') {
    const { shop_id } = req.query;

    if (!shop_id) {
      return res.status(400).json({ error: 'Shop ID required' });
    }

    // Get shop details
    const { data: shop, error: shopError } = await supabaseAdmin
      .from('shops')
      .select(`
        id,
        merchant_id,
        shop_name,
        proprietor_name,
        phone,
        address,
        image_url,
        rating_cache,
        created_at,
        profiles:merchant_id (full_name)
      `)
      .eq('id', shop_id)
      .single();

    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Get shop's products (via shop_products)
    const { data: products, error: productsError } = await supabaseAdmin
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
      .eq('shop_id', shop_id)
      .eq('is_visible', true)
      .order('created_at', { ascending: false });

    if (productsError) {
      return res.status(500).json({ error: productsError.message });
    }

    const formattedProducts = products.map(sp => ({
      shop_product_id: sp.id,
      product_id: sp.products?.id,
      title: sp.products?.title,
      description: sp.products?.description,
      price: sp.custom_price || sp.products?.price,
      image_url: sp.products?.image_url,
      category: sp.products?.categories?.name || 'Uncategorized',
    }));

    return res.status(200).json({
      shop: {
        id: shop.id,
        shop_name: shop.shop_name,
        proprietor_name: shop.proprietor_name,
        phone: shop.phone,
        address: shop.address,
        image_url: shop.image_url,
        rating: shop.rating_cache,
        merchant_name: shop.profiles?.full_name || shop.proprietor_name,
        created_at: shop.created_at,
      },
      products: formattedProducts,
    });
  }

  // ============================================================
  // CATEGORIES – FOR DROPDOWNS (Public)
  // ============================================================
  if (action === 'categories') {
    const { data: categories, error } = await supabaseAdmin
      .from('categories')
      .select('id, name')
      .order('name');

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ categories });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
