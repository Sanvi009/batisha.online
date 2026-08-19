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
  // PLACE ORDER (User only)
  // ============================================================
  if (action === 'place') {
    if (userRole !== 'user') {
      return res.status(403).json({ error: 'Only users can place orders.' });
    }

    const { shop_id, items, delivery_fee, special_note, address_id } = req.body;

    if (!shop_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Shop ID and items array are required.' });
    }

    // Get the user's address
    let addressName = 'Unknown', addressPhone = 'Unknown', addressText = 'Unknown';
    if (address_id) {
      const { data: addr } = await supabaseAdmin
        .from('user_addresses')
        .select('name, phone, address')
        .eq('id', address_id)
        .eq('user_id', userId)
        .single();

      if (addr) {
        addressName = addr.name;
        addressPhone = addr.phone;
        addressText = addr.address;
      }
    }

    // Calculate total price
    let totalPrice = 0;
    const orderItems = [];

    for (const item of items) {
      const { shop_product_id, quantity, offer_id } = item;

      if (!shop_product_id || !quantity || quantity < 1) {
        return res.status(400).json({ error: 'Invalid item data.' });
      }

      let priceAtTime = 0;
      let productId = null;

      // Check if it's an offer or regular product
      if (offer_id) {
        const { data: offer } = await supabaseAdmin
          .from('offers')
          .select('id, offer_price, product_id')
          .eq('id', offer_id)
          .gt('expires_at', new Date().toISOString())
          .single();

        if (!offer) {
          return res.status(400).json({ error: 'Offer expired or not found.' });
        }
        priceAtTime = offer.offer_price;
        productId = offer.product_id;
      } else {
        const { data: sp } = await supabaseAdmin
          .from('shop_products')
          .select('id, custom_price, product_id, products:product_id (price)')
          .eq('id', shop_product_id)
          .eq('shop_id', shop_id)
          .single();

        if (!sp) {
          return res.status(400).json({ error: 'Product not found in this shop.' });
        }
        priceAtTime = sp.custom_price || sp.products?.price || 0;
        productId = sp.product_id;
      }

      totalPrice += priceAtTime * quantity;
      orderItems.push({
        shop_product_id,
        product_id: productId,
        offer_id: offer_id || null,
        quantity,
        price_at_time: priceAtTime,
      });
    }

    // Add delivery fee
    const fee = delivery_fee || 0;
    totalPrice += fee;

    // Create order
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: userId,
        shop_id,
        delivery_fee: fee,
        special_note: special_note || null,
        total_price: totalPrice,
        status: 'pending',
      })
      .select()
      .single();

    if (orderError) {
      return res.status(500).json({ error: orderError.message });
    }

    // Insert order items
    const orderItemsData = orderItems.map(item => ({
      order_id: order.id,
      product_id: item.product_id,
      offer_id: item.offer_id,
      quantity: item.quantity,
      price_at_time: item.price_at_time,
    }));

    const { error: itemsError } = await supabaseAdmin
      .from('order_items')
      .insert(orderItemsData);

    if (itemsError) {
      // Rollback order if items fail
      await supabaseAdmin.from('orders').delete().eq('id', order.id);
      return res.status(500).json({ error: itemsError.message });
    }

    return res.status(201).json({
      success: true,
      order: {
        id: order.id,
        total_price: order.total_price,
        status: order.status,
        created_at: order.created_at,
      },
    });
  }

  // ============================================================
  // GET USER'S OWN ORDERS (User only)
  // ============================================================
  if (action === 'my-orders') {
    if (userRole !== 'user') {
      return res.status(403).json({ error: 'Only users can view their orders.' });
    }

    const { limit = 20, offset = 0 } = req.query;

    const { data: orders, error, count } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        delivery_fee,
        special_note,
        total_price,
        status,
        created_at,
        updated_at,
        shops:shop_id (shop_name, image_url),
        order_items (
          id,
          quantity,
          price_at_time,
          products:product_id (title, image_url),
          offers:offer_id (title, image_url)
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      orders,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0),
    });
  }

  // ============================================================
  // GET ALL ORDERS (Admin only)
  // ============================================================
  if (action === 'all') {
    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Forbidden — Admin access only.' });
    }

    const { limit = 50, offset = 0 } = req.query;

    const { data: orders, error, count } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        delivery_fee,
        special_note,
        total_price,
        status,
        created_at,
        updated_at,
        profiles:user_id (full_name, phone),
        shops:shop_id (shop_name)
      `)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      orders,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0),
    });
  }

  // ============================================================
  // MERCHANT ORDERS (Merchant only) – already written
  // ============================================================
  if (action === 'shop-orders') {
    if (userRole !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden — Merchant access only' });
    }

    const { data: shop, error: shopError } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', userId)
      .single();

    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shop.id;

    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        user_id,
        delivery_fee,
        special_note,
        total_price,
        status,
        created_at,
        updated_at,
        profiles:user_id (full_name, phone),
        order_items (
          id,
          quantity,
          price_at_time,
          products:product_id (title, image_url),
          offers:offer_id (title, image_url)
        )
      `)
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false });

    if (ordersError) {
      return res.status(500).json({ error: ordersError.message });
    }

    return res.status(200).json({ orders });
  }

  // ============================================================
  // UPDATE ORDER STATUS (Merchant only) – already written
  // ============================================================
  if (action === 'update-status') {
    if (userRole !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden — Merchant access only' });
    }

    const { orderId, status } = req.body;

    if (!orderId || !status) {
      return res.status(400).json({ error: 'Order ID and status are required' });
    }

    const validStatuses = ['processing', 'packed', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const { data: shop } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', userId)
      .single();

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('id, shop_id')
      .eq('id', orderId)
      .eq('shop_id', shop.id)
      .single();

    if (!order) {
      return res.status(404).json({ error: 'Order not found or does not belong to your shop' });
    }

    const { data: updatedOrder, error } = await supabaseAdmin
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true, order: updatedOrder });
  }

  // ============================================================
  // DELETE ORDER (Merchant only) – already written
  // ============================================================
  if (action === 'delete') {
    if (userRole !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden — Merchant access only' });
    }

    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'Order ID required' });
    }

    const { data: shop } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', userId)
      .single();

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('id, shop_id')
      .eq('id', orderId)
      .eq('shop_id', shop.id)
      .single();

    if (!order) {
      return res.status(404).json({ error: 'Order not found or does not belong to your shop' });
    }

    const { error } = await supabaseAdmin
      .from('orders')
      .delete()
      .eq('id', orderId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
