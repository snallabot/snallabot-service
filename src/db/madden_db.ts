import { randomUUID } from "crypto"
import { Timestamp, Filter } from "firebase-admin/firestore"
import db from "./firebase"
import { EventNotifier, SnallabotEvent, StoredEvent } from "./events_db"

type HistoryUpdate<ValueType> = { oldValue: ValueType, newValue: ValueType }
type History = { [key: string]: HistoryUpdate<any> }
type StoredHistory = { timestamp: Date } & History


interface MaddenDB {
    appendEvents<Event>(event: SnallabotEvent<Event>[], idFn: (event: Event) => string): Promise<void>
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

const notifiers: { [key: string]: EventNotifier<any>[] } = {}

function createEventHistoryUpdate(newEvent: Record<string, any>, oldEvent: Record<string, any>): History {
    const change: History = {}
    Object.keys(newEvent).forEach(key => {
        const oldValue = oldEvent[key]
        if (typeof oldValue !== 'object') {
            const newValue = newEvent[key]
            if (newValue !== oldValue) {
                change[key] = { oldValue, newValue }
            }
        }
    })
    return change
}
const MaddenDB: MaddenDB = {
    async appendEvents<Event>(events: SnallabotEvent<Event>[], idFn: (event: Event) => string) {
        const batch = db.batch()
        const timestamp = new Date()
        await Promise.all(events.map(async event => {
            const eventId = idFn(event)
            const doc = db.collection("league_data").doc(event.key).collection(event.event_type).doc(eventId)
            const fetchedDoc = await doc.get()
            if (fetchedDoc.exists) {
                const { timestamp, id, ...oldEvent } = fetchedDoc.data() as StoredEvent<Event>
                const change = createEventHistoryUpdate(event, oldEvent)
                if (Object.keys(change).length > 0) {
                    const changeId = randomUUID()
                    const historyDoc = db.collection("league_data").doc(event.key).collection(event.event_type).doc(eventId).collection("history").doc(changeId)
                    batch.set(historyDoc, { ...change, timestamp: timestamp })
                }
            }
            batch.set(doc, { ...event, timestamp: timestamp, id: eventId })
        }))
        await batch.commit()
        Object.entries(Object.groupBy(events, e => e.event_type)).map(entry => {
            const [eventType, specificTypeEvents] = entry
            if (specificTypeEvents) {
                const eventTypeNotifiers = notifiers[eventType]
                if (eventTypeNotifiers) {
                    eventTypeNotifiers.forEach(notifier => {
                        notifier(specificTypeEvents)
                    })
                }
            }
        })
    },
    on<Event>(event_type: string, notifier: EventNotifier<Event>) {
        const currentNotifiers = notifiers[event_type] || []
        notifiers[event_type] = [notifier].concat(currentNotifiers)
    }
}
export default MaddenDB
