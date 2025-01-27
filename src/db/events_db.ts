import { randomUUID } from "crypto"
import { Timestamp, Filter } from "firebase-admin/firestore"
import db from "./firebase"

type EventId = string
export type SnallabotEvent<Event> = { key: string, event_type: string } & Event
export type StoredEvent<Event> = SnallabotEvent<Event> & { timestamp: Date, id: EventId }
export type Filters = { [key: string]: any } | {}
export enum EventDelivery {
  EVENT_SOURCE = "EVENT_SOURCE",
  EVENT_TRIGGER = "EVENT_TRIGGER"
}


export type EventNotifier<Event> = (events: SnallabotEvent<Event>[]) => Promise<void>
interface EventDB {
  appendEvents<Event>(event: SnallabotEvent<Event>[], delivery: EventDelivery): Promise<void>
  queryEvents<Event>(key: string, event_type: string, after: Date, filters: Filters, limit: number): Promise<StoredEvent<Event>[]>,
  on<Event>(event_type: string, notifier: EventNotifier<Event>): void
}

function convertDate(firebaseObject: any) {
  if (!firebaseObject) return null;

  for (const [key, value] of Object.entries(firebaseObject)) {

    // covert items inside array
    if (value && Array.isArray(value))
      firebaseObject[key] = value.map(item => convertDate(item));

    // convert inner objects
    if (value && typeof value === 'object') {
      firebaseObject[key] = convertDate(value);
    }

    // convert simple properties
    if (value && value.hasOwnProperty('_seconds'))
      firebaseObject[key] = (value as Timestamp).toDate();
  }
  return firebaseObject;
}

export const notifiers: { [key: string]: EventNotifier<any>[] } = {}
const EventDB: EventDB = {
  async appendEvents<Event>(events: Array<SnallabotEvent<Event>>, delivery: EventDelivery) {
    if (delivery === EventDelivery.EVENT_SOURCE) {

      const batch = db.batch()
      const timestamp = new Date()
      events.forEach(event => {
        const eventId = randomUUID()
        const doc = db.collection("events").doc(event.key).collection(event.event_type).doc(eventId)
        batch.set(doc, { ...event, timestamp: timestamp, id: eventId })
      })
      await batch.commit()
    }
    Object.entries(Object.groupBy(events, e => e.event_type)).map(async entry => {
      const [eventType, specificTypeEvents] = entry
      if (specificTypeEvents) {
        const eventTypeNotifiers = notifiers[eventType]
        if (eventTypeNotifiers) {
          await Promise.all(eventTypeNotifiers.map(async notifier => {
            try {
              await notifier(specificTypeEvents)
            } catch (e) {
              console.log("could not send events to notifier " + e)
            }
          }))
        }
      }
    })
  },
  async queryEvents<Event>(key: string, event_type: string, after: Date, filters: Filters, limit: number) {
    const events = await db.collection("events").doc(key).collection(event_type).where(
      Filter.and(...[Filter.where("timestamp", ">", after), ...
        Object.entries(filters).map(e => {
          const [property, value] = e
          return Filter.where(property, "==", value)
        })]
      )).orderBy("timestamp", "desc").limit(limit).get()
    return events.docs.map(doc => convertDate(doc.data()) as StoredEvent<Event>)
  },
  on<Event>(event_type: string, notifier: EventNotifier<Event>) {
    const currentNotifiers = notifiers[event_type] || []
    notifiers[event_type] = [notifier].concat(currentNotifiers)
  }
}
export default EventDB
