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
  // LIST ORDERS FOR A SHOP (Merchant only)
  // ============================================================
  if (action === 'shop-orders') {
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

    // Fetch orders with user details and order items
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
        profiles:user_id (
          full_name,
          phone
        ),
        order_items (
          id,
          quantity,
          price_at_time,
          products:product_id (
            title,
            image_url
          ),
          offers:offer_id (
            title,
            image_url
          )
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
  // UPDATE ORDER STATUS (Merchant only)
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

    // Verify this order belongs to the merchant's shop
    const { data: shop, error: shopError } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', userId)
      .single();

    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, shop_id')
      .eq('id', orderId)
      .eq('shop_id', shop.id)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found or does not belong to your shop' });
    }

    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    return res.status(200).json({
      success: true,
      order: updatedOrder,
    });
  }

  // ============================================================
  // DELETE ORDER (Merchant only)
  // ============================================================
  if (action === 'delete') {
    if (userRole !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden — Merchant access only' });
    }

    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'Order ID required' });
    }

    // Verify this order belongs to the merchant's shop
    const { data: shop, error: shopError } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', userId)
      .single();

    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, shop_id')
      .eq('id', orderId)
      .eq('shop_id', shop.id)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found or does not belong to your shop' });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('orders')
      .delete()
      .eq('id', orderId);

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }

    return res.status(200).json({
      success: true,
      message: 'Order deleted successfully',
    });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
