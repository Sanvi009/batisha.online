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
  // LIST REVIEWS FOR A PRODUCT (Public)
  // ============================================================
  if (action === 'list') {
    const { product_id, limit = 20, offset = 0 } = req.query;

    if (!product_id) {
      return res.status(400).json({ error: 'Product ID required' });
    }

    const { data: reviews, error, count } = await supabaseAdmin
      .from('reviews')
      .select(`
        id,
        user_id,
        rating,
        comment,
        created_at,
        profiles:user_id (full_name)
      `)
      .eq('product_id', product_id)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Format response
    const formatted = reviews.map(r => ({
      id: r.id,
      user_name: r.profiles?.full_name || 'Anonymous',
      rating: r.rating,
      comment: r.comment,
      created_at: r.created_at,
    }));

    return res.status(200).json({
      reviews: formatted,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0)
    });
  }

  // ============================================================
  // CREATE REVIEW (User only – must have purchased)
  // ============================================================
  if (action === 'create') {
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { product_id, order_item_id, rating, comment } = req.body;

    if (!product_id || !order_item_id || !rating) {
      return res.status(400).json({ error: 'Product ID, Order Item ID, and rating are required.' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }

    // Verify the order_item belongs to this user and is delivered
    const { data: orderItem, error: checkError } = await supabaseAdmin
      .from('order_items')
      .select(`
        id,
        order_id,
        product_id,
        orders:order_id (
          user_id,
          status
        )
      `)
      .eq('id', order_item_id)
      .single();

    if (checkError || !orderItem) {
      return res.status(404).json({ error: 'Order item not found.' });
    }

    if (orderItem.orders?.user_id !== userId) {
      return res.status(403).json({ error: 'You did not purchase this product.' });
    }

    if (orderItem.orders?.status !== 'delivered') {
      return res.status(400).json({ error: 'You can only review delivered products.' });
    }

    // Check if already reviewed
    const { data: existing } = await supabaseAdmin
      .from('reviews')
      .select('id')
      .eq('order_item_id', order_item_id)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'You have already reviewed this product.' });
    }

    const { data: review, error } = await supabaseAdmin
      .from('reviews')
      .insert({
        user_id: userId,
        product_id,
        order_item_id,
        rating,
        comment: comment || null,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({
      success: true,
      review: {
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        created_at: review.created_at,
      },
    });
  }

  // ============================================================
  // DELETE REVIEW (User or Admin)
  // ============================================================
  if (action === 'delete') {
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { review_id } = req.body;

    if (!review_id) {
      return res.status(400).json({ error: 'Review ID required.' });
    }

    // Fetch the review
    const { data: review, error: fetchError } = await supabaseAdmin
      .from('reviews')
      .select('user_id')
      .eq('id', review_id)
      .single();

    if (fetchError || !review) {
      return res.status(404).json({ error: 'Review not found.' });
    }

    // Check permission: user owns it OR user is admin
    if (review.user_id !== userId && userRole !== 'admin') {
      return res.status(403).json({ error: 'You can only delete your own reviews.' });
    }

    const { error } = await supabaseAdmin
      .from('reviews')
      .delete()
      .eq('id', review_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      message: 'Review deleted.',
    });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
