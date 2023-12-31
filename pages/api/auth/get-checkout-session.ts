import { NextApiRequest, NextApiResponse } from 'next'
import { stripe } from '@/utils/stripe'
import { getOrCreateCustomer } from '@/utils/data/customer'
import { HttpError } from '@/types/http-error'
import { getUserByToken } from '@/utils/auth'

type Data = {
  sessionId?: string
  error?: HttpError
}

export default async function createCheckoutSession(req: NextApiRequest, res: NextApiResponse<Data>) {
  if (req.method === 'POST') {
    try {
      const token = req.headers.token as string
      const { user } = await getUserByToken(token)
      const { priceId, quantity = 1, metadata = {} } = req.body
      const customerId = await getOrCreateCustomer(user.id, user.email)
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        billing_address_collection: 'required',
        customer: customerId,
        line_items: [
          {
            price: priceId,
            quantity
          }
        ],
        mode: 'subscription',
        allow_promotion_codes: true,
        subscription_data: {
          trial_from_plan: true,
          metadata
        },
        success_url: process.env.CHECKOUT_SUCCESS_REDIRECT_URL,
        cancel_url: process.env.CHECKOUT_CANCEL_REDIRECT_URL,
      })

      return res
        .status(200)
        .json({ sessionId: session.id })

    } catch (err) {
      console.error(err)
      return res
        .status(500)
        .json({
          error: {
            statusCode: 500,
            type: 'internal_server_error',
            message: err.message,
          }
        })
    }
  } else {
    res.setHeader('Allow', 'POST')
    res.status(405).end('Method Not Allowed')
  }
}
