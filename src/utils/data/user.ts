import { Subscription } from '@/types/subscription'
import Stripe from 'stripe'
import { stripe } from '../stripe'
import { supabaseAdmin } from '../supabase-admin-client'
import { supportedImageTypes } from '../supported-image-types'

export const getSubscriptionForUser =
  async (userId: string): Promise<Subscription | null> => {
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*, prices(*, products(*))')
      .in('status', ['trialing', 'active'])
      .eq('user_id', userId)
      .single()

    if (error) {
      return null
    } else {
      return data as Subscription
    }
  }

export const manageSubscriptionStatusChange = async (
  subscriptionId: string,
  customerId: string,
  createAction: boolean = false,
) => {
  const {
    data: { user_id: uuid },
    error: noCustomerError
  } = await supabaseAdmin
    .from('stripe_customers')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .single()

  if (noCustomerError) {
    console.error(`Customer with Stripe ID ${customerId} not found.`)
    return
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['default_payment_method']
  })

  const { error } = await supabaseAdmin
    .from('subscriptions')
    .upsert({
      id: subscription.id,
      user_id: uuid,
      metadata: subscription.metadata,
      status: subscription.status,
      price_id: subscription.items.data[0].price.id,
      quantity: (subscription as any).quantity,
      cancel_at_period_end: subscription.cancel_at_period_end,
      cancel_at: subscription.cancel_at ? toDateTime(subscription.cancel_at) : null,
      canceled_at: subscription.canceled_at ? toDateTime(subscription.canceled_at) : null,
      current_period_start: toDateTime(subscription.current_period_start),
      current_period_end: toDateTime(subscription.current_period_end),
      created: toDateTime(subscription.created),
      ended_at: subscription.ended_at ? toDateTime(subscription.ended_at) : null,
      trial_start: subscription.trial_start ? toDateTime(subscription.trial_start) : null,
      trial_end: subscription.trial_end ? toDateTime(subscription.trial_end) : null
    })

  if (error) {
    console.error(`An error occurred while saving subscription: ${error.message}`)
  } else {
    console.log(`Saved subscription ${subscription.id} for user ${uuid}`)
  }

  if (createAction && subscription.default_payment_method) {
    await copyBillingDetailsToCustomer(uuid, subscription.default_payment_method)
  }
}

export const updateStripeUserDetails = async (
  customerId: string,
  address: Stripe.Address,
  payment_method: string,
) => {
  const {
    data: { user_id: uuid },
    error: noCustomerError
  } = await supabaseAdmin
    .from('stripe_customers')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .single()

  if (noCustomerError) {
    console.error(`Customer with Stripe ID ${customerId} not found.`)
    return
  }

  if (payment_method) {
    const paymentMethod = await stripe.paymentMethods.retrieve(payment_method)
    const { error: updatePaymentMethodError } = await supabaseAdmin
      .from('user_details')
      .update({
        payment_method: paymentMethod[paymentMethod.type],
      })
      .eq('id', uuid)

    if (updatePaymentMethodError) {
      console.error(`An error occurred while updating payment method: ${updatePaymentMethodError.message}`)
    }
  }

  if (address) {
    const { error } = await supabaseAdmin
      .from('user_details')
      .update({
        billing_address: address,
      })
      .eq('id', uuid)

    if (error) {
      console.error(`An error occurred while updating user details: ${error.message}`)
    }
  }
}

export const deleteUser = async (userId: string) => {

  // delete user profile pictures
  const fileName = Buffer.from(userId.replace(/-/g, ''), 'base64').toString('base64')
  const filePaths = supportedImageTypes.map(t => `public/${fileName}${t.extension}`)
  const { error: profilePicError } = await supabaseAdmin
    .storage
    .from('avatars')
    .remove(filePaths)

  const { error: stripeCustomerError } = await supabaseAdmin
    .from('stripe_customers')
    .delete()
    .match({ user_id: userId })

  const { error: subscriptionError } = await supabaseAdmin
    .from('subscriptions')
    .delete()
    .match({ user_id: userId })

  const { error: userDetailError } = await supabaseAdmin
    .from('user_details')
    .delete()
    .match({ id: userId })

  const { error: userDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)

  if (profilePicError || stripeCustomerError || subscriptionError || userDetailError || userDeleteError) {
    throw (
      `Failed to delete user:
      Profile picture delete error: ${profilePicError?.message}
      Stripe customer delete error: ${stripeCustomerError?.message}
      Subscription delete error: ${subscriptionError?.message}
      User detail delete error: ${userDetailError?.message}
      User delete error: ${userDeleteError?.message}`
    )
  }
}

const copyBillingDetailsToCustomer = async (
  uuid: string,
  payment_method: Stripe.PaymentMethod | string,
) => {
  if (typeof payment_method !== 'string') {
    const { address } = payment_method.billing_details
    const { error } = await supabaseAdmin
      .from('user_details')
      .update({
        billing_address: address,
        payment_method: payment_method[payment_method.type]
      })
      .eq('id', uuid)

    if (error) {
      console.error(`An error occurred while updating user details: ${error.message}`)
    }
  }
}

const toDateTime = (secs: number) => {
  return new Date(secs * 1000)
}
