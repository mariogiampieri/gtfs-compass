import * as $protobuf from "protobufjs";
import Long = require("long");

/** Namespace transit_realtime. */
export namespace transit_realtime {

    /**
     * Properties of a FeedMessage.
     * @deprecated Use transit_realtime.FeedMessage.$Properties instead.
     */
    interface IFeedMessage extends transit_realtime.FeedMessage.$Properties {
    }

    /** Represents a FeedMessage. */
    class FeedMessage {

        /**
         * Constructs a new FeedMessage.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.FeedMessage.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** FeedMessage header. */
        header: transit_realtime.FeedHeader.$Properties;

        /** FeedMessage entity. */
        entity: transit_realtime.FeedEntity.$Properties[];

        /**
         * Encodes the specified FeedMessage message. Does not implicitly {@link transit_realtime.FeedMessage.verify|verify} messages.
         * @param message FeedMessage message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.FeedMessage.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a FeedMessage message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.FeedMessage & transit_realtime.FeedMessage.$Shape} FeedMessage
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.FeedMessage & transit_realtime.FeedMessage.$Shape;

        /**
         * Gets the type url for FeedMessage
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace FeedMessage {

        /** Properties of a FeedMessage. */
        interface $Properties {

            /** FeedMessage header */
            header: transit_realtime.FeedHeader.$Properties;

            /** FeedMessage entity */
            entity?: (transit_realtime.FeedEntity.$Properties[]|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a FeedMessage. */
        type $Shape = transit_realtime.FeedMessage.$Properties;
    }

    /**
     * Properties of a FeedHeader.
     * @deprecated Use transit_realtime.FeedHeader.$Properties instead.
     */
    interface IFeedHeader extends transit_realtime.FeedHeader.$Properties {
    }

    /** Represents a FeedHeader. */
    class FeedHeader {

        /**
         * Constructs a new FeedHeader.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.FeedHeader.$Properties);

        /** FeedHeader .transit_realtime.nyctFeedHeader */
        ".transit_realtime.nyctFeedHeader"?: (transit_realtime.NyctFeedHeader.$Properties|null);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** FeedHeader gtfsRealtimeVersion. */
        gtfsRealtimeVersion: string;

        /** FeedHeader incrementality. */
        incrementality: transit_realtime.FeedHeader.Incrementality;

        /** FeedHeader timestamp. */
        timestamp: (number|Long);

        /** FeedHeader feedVersion. */
        feedVersion: string;

        /**
         * Encodes the specified FeedHeader message. Does not implicitly {@link transit_realtime.FeedHeader.verify|verify} messages.
         * @param message FeedHeader message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.FeedHeader.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a FeedHeader message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.FeedHeader & transit_realtime.FeedHeader.$Shape} FeedHeader
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.FeedHeader & transit_realtime.FeedHeader.$Shape;

        /**
         * Gets the type url for FeedHeader
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace FeedHeader {

        /** Properties of a FeedHeader. */
        interface $Properties {

            /** FeedHeader gtfsRealtimeVersion */
            gtfsRealtimeVersion: string;

            /** FeedHeader incrementality */
            incrementality?: (transit_realtime.FeedHeader.Incrementality|null);

            /** FeedHeader timestamp */
            timestamp?: (number|Long|null);

            /** FeedHeader feedVersion */
            feedVersion?: (string|null);

            /** FeedHeader .transit_realtime.nyctFeedHeader */
            ".transit_realtime.nyctFeedHeader"?: (transit_realtime.NyctFeedHeader.$Properties|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a FeedHeader. */
        type $Shape = transit_realtime.FeedHeader.$Properties;

        /** Incrementality enum. */
        enum Incrementality {

            /** FULL_DATASET value */
            FULL_DATASET = 0,

            /** DIFFERENTIAL value */
            DIFFERENTIAL = 1
        }
    }

    /**
     * Properties of a FeedEntity.
     * @deprecated Use transit_realtime.FeedEntity.$Properties instead.
     */
    interface IFeedEntity extends transit_realtime.FeedEntity.$Properties {
    }

    /** Represents a FeedEntity. */
    class FeedEntity {

        /**
         * Constructs a new FeedEntity.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.FeedEntity.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** FeedEntity id. */
        id: string;

        /** FeedEntity isDeleted. */
        isDeleted: boolean;

        /** FeedEntity tripUpdate. */
        tripUpdate?: (transit_realtime.TripUpdate.$Properties|null);

        /** FeedEntity vehicle. */
        vehicle?: (transit_realtime.VehiclePosition.$Properties|null);

        /** FeedEntity alert. */
        alert?: (transit_realtime.Alert.$Properties|null);

        /** FeedEntity shape. */
        shape?: (transit_realtime.Shape.$Properties|null);

        /** FeedEntity stop. */
        stop?: (transit_realtime.Stop.$Properties|null);

        /** FeedEntity tripModifications. */
        tripModifications?: (transit_realtime.TripModifications.$Properties|null);

        /**
         * Encodes the specified FeedEntity message. Does not implicitly {@link transit_realtime.FeedEntity.verify|verify} messages.
         * @param message FeedEntity message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.FeedEntity.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a FeedEntity message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.FeedEntity & transit_realtime.FeedEntity.$Shape} FeedEntity
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.FeedEntity & transit_realtime.FeedEntity.$Shape;

        /**
         * Gets the type url for FeedEntity
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace FeedEntity {

        /** Properties of a FeedEntity. */
        interface $Properties {

            /** FeedEntity id */
            id: string;

            /** FeedEntity isDeleted */
            isDeleted?: (boolean|null);

            /** FeedEntity tripUpdate */
            tripUpdate?: (transit_realtime.TripUpdate.$Properties|null);

            /** FeedEntity vehicle */
            vehicle?: (transit_realtime.VehiclePosition.$Properties|null);

            /** FeedEntity alert */
            alert?: (transit_realtime.Alert.$Properties|null);

            /** FeedEntity shape */
            shape?: (transit_realtime.Shape.$Properties|null);

            /** FeedEntity stop */
            stop?: (transit_realtime.Stop.$Properties|null);

            /** FeedEntity tripModifications */
            tripModifications?: (transit_realtime.TripModifications.$Properties|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a FeedEntity. */
        type $Shape = transit_realtime.FeedEntity.$Properties;
    }

    /**
     * Properties of a TripUpdate.
     * @deprecated Use transit_realtime.TripUpdate.$Properties instead.
     */
    interface ITripUpdate extends transit_realtime.TripUpdate.$Properties {
    }

    /** Represents a TripUpdate. */
    class TripUpdate {

        /**
         * Constructs a new TripUpdate.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.TripUpdate.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** TripUpdate trip. */
        trip: transit_realtime.TripDescriptor.$Properties;

        /** TripUpdate vehicle. */
        vehicle?: (transit_realtime.VehicleDescriptor.$Properties|null);

        /** TripUpdate stopTimeUpdate. */
        stopTimeUpdate: transit_realtime.TripUpdate.StopTimeUpdate.$Properties[];

        /** TripUpdate timestamp. */
        timestamp: (number|Long);

        /** TripUpdate delay. */
        delay: number;

        /** TripUpdate tripProperties. */
        tripProperties?: (transit_realtime.TripUpdate.TripProperties.$Properties|null);

        /**
         * Encodes the specified TripUpdate message. Does not implicitly {@link transit_realtime.TripUpdate.verify|verify} messages.
         * @param message TripUpdate message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.TripUpdate.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a TripUpdate message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.TripUpdate & transit_realtime.TripUpdate.$Shape} TripUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripUpdate & transit_realtime.TripUpdate.$Shape;

        /**
         * Gets the type url for TripUpdate
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace TripUpdate {

        /** Properties of a TripUpdate. */
        interface $Properties {

            /** TripUpdate trip */
            trip: transit_realtime.TripDescriptor.$Properties;

            /** TripUpdate vehicle */
            vehicle?: (transit_realtime.VehicleDescriptor.$Properties|null);

            /** TripUpdate stopTimeUpdate */
            stopTimeUpdate?: (transit_realtime.TripUpdate.StopTimeUpdate.$Properties[]|null);

            /** TripUpdate timestamp */
            timestamp?: (number|Long|null);

            /** TripUpdate delay */
            delay?: (number|null);

            /** TripUpdate tripProperties */
            tripProperties?: (transit_realtime.TripUpdate.TripProperties.$Properties|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a TripUpdate. */
        type $Shape = transit_realtime.TripUpdate.$Properties;

        /**
         * Properties of a StopTimeEvent.
         * @deprecated Use transit_realtime.TripUpdate.StopTimeEvent.$Properties instead.
         */
        interface IStopTimeEvent extends transit_realtime.TripUpdate.StopTimeEvent.$Properties {
        }

        /** Represents a StopTimeEvent. */
        class StopTimeEvent {

            /**
             * Constructs a new StopTimeEvent.
             * @param [properties] Properties to set
             */
            constructor(properties?: transit_realtime.TripUpdate.StopTimeEvent.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** StopTimeEvent delay. */
            delay: number;

            /** StopTimeEvent time. */
            time: (number|Long);

            /** StopTimeEvent uncertainty. */
            uncertainty: number;

            /** StopTimeEvent scheduledTime. */
            scheduledTime: (number|Long);

            /**
             * Encodes the specified StopTimeEvent message. Does not implicitly {@link transit_realtime.TripUpdate.StopTimeEvent.verify|verify} messages.
             * @param message StopTimeEvent message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: transit_realtime.TripUpdate.StopTimeEvent.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a StopTimeEvent message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {transit_realtime.TripUpdate.StopTimeEvent & transit_realtime.TripUpdate.StopTimeEvent.$Shape} StopTimeEvent
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripUpdate.StopTimeEvent & transit_realtime.TripUpdate.StopTimeEvent.$Shape;

            /**
             * Gets the type url for StopTimeEvent
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace StopTimeEvent {

            /** Properties of a StopTimeEvent. */
            interface $Properties {

                /** StopTimeEvent delay */
                delay?: (number|null);

                /** StopTimeEvent time */
                time?: (number|Long|null);

                /** StopTimeEvent uncertainty */
                uncertainty?: (number|null);

                /** StopTimeEvent scheduledTime */
                scheduledTime?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a StopTimeEvent. */
            type $Shape = transit_realtime.TripUpdate.StopTimeEvent.$Properties;
        }

        /**
         * Properties of a StopTimeUpdate.
         * @deprecated Use transit_realtime.TripUpdate.StopTimeUpdate.$Properties instead.
         */
        interface IStopTimeUpdate extends transit_realtime.TripUpdate.StopTimeUpdate.$Properties {
        }

        /** Represents a StopTimeUpdate. */
        class StopTimeUpdate {

            /**
             * Constructs a new StopTimeUpdate.
             * @param [properties] Properties to set
             */
            constructor(properties?: transit_realtime.TripUpdate.StopTimeUpdate.$Properties);

            /** StopTimeUpdate .transit_realtime.nyctStopTimeUpdate */
            ".transit_realtime.nyctStopTimeUpdate"?: (transit_realtime.NyctStopTimeUpdate.$Properties|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** StopTimeUpdate stopSequence. */
            stopSequence: number;

            /** StopTimeUpdate stopId. */
            stopId: string;

            /** StopTimeUpdate arrival. */
            arrival?: (transit_realtime.TripUpdate.StopTimeEvent.$Properties|null);

            /** StopTimeUpdate departure. */
            departure?: (transit_realtime.TripUpdate.StopTimeEvent.$Properties|null);

            /** StopTimeUpdate departureOccupancyStatus. */
            departureOccupancyStatus: transit_realtime.VehiclePosition.OccupancyStatus;

            /** StopTimeUpdate scheduleRelationship. */
            scheduleRelationship: transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship;

            /** StopTimeUpdate stopTimeProperties. */
            stopTimeProperties?: (transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties|null);

            /**
             * Encodes the specified StopTimeUpdate message. Does not implicitly {@link transit_realtime.TripUpdate.StopTimeUpdate.verify|verify} messages.
             * @param message StopTimeUpdate message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: transit_realtime.TripUpdate.StopTimeUpdate.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a StopTimeUpdate message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {transit_realtime.TripUpdate.StopTimeUpdate & transit_realtime.TripUpdate.StopTimeUpdate.$Shape} StopTimeUpdate
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripUpdate.StopTimeUpdate & transit_realtime.TripUpdate.StopTimeUpdate.$Shape;

            /**
             * Gets the type url for StopTimeUpdate
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace StopTimeUpdate {

            /** Properties of a StopTimeUpdate. */
            interface $Properties {

                /** StopTimeUpdate stopSequence */
                stopSequence?: (number|null);

                /** StopTimeUpdate stopId */
                stopId?: (string|null);

                /** StopTimeUpdate arrival */
                arrival?: (transit_realtime.TripUpdate.StopTimeEvent.$Properties|null);

                /** StopTimeUpdate departure */
                departure?: (transit_realtime.TripUpdate.StopTimeEvent.$Properties|null);

                /** StopTimeUpdate departureOccupancyStatus */
                departureOccupancyStatus?: (transit_realtime.VehiclePosition.OccupancyStatus|null);

                /** StopTimeUpdate scheduleRelationship */
                scheduleRelationship?: (transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship|null);

                /** StopTimeUpdate stopTimeProperties */
                stopTimeProperties?: (transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties|null);

                /** StopTimeUpdate .transit_realtime.nyctStopTimeUpdate */
                ".transit_realtime.nyctStopTimeUpdate"?: (transit_realtime.NyctStopTimeUpdate.$Properties|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a StopTimeUpdate. */
            type $Shape = transit_realtime.TripUpdate.StopTimeUpdate.$Properties;

            /** ScheduleRelationship enum. */
            enum ScheduleRelationship {

                /** SCHEDULED value */
                SCHEDULED = 0,

                /** SKIPPED value */
                SKIPPED = 1,

                /** NO_DATA value */
                NO_DATA = 2,

                /** UNSCHEDULED value */
                UNSCHEDULED = 3
            }

            /**
             * Properties of a StopTimeProperties.
             * @deprecated Use transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties instead.
             */
            interface IStopTimeProperties extends transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties {
            }

            /** Represents a StopTimeProperties. */
            class StopTimeProperties {

                /**
                 * Constructs a new StopTimeProperties.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];

                /** StopTimeProperties assignedStopId. */
                assignedStopId: string;

                /** StopTimeProperties stopHeadsign. */
                stopHeadsign: string;

                /** StopTimeProperties pickupType. */
                pickupType: transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.DropOffPickupType;

                /** StopTimeProperties dropOffType. */
                dropOffType: transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.DropOffPickupType;

                /**
                 * Encodes the specified StopTimeProperties message. Does not implicitly {@link transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.verify|verify} messages.
                 * @param message StopTimeProperties message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                static encode(message: transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a StopTimeProperties message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns {transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties & transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Shape} StopTimeProperties
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties & transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Shape;

                /**
                 * Gets the type url for StopTimeProperties
                 * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns The type url
                 */
                static getTypeUrl(prefix?: string): string;
            }

            namespace StopTimeProperties {

                /** Properties of a StopTimeProperties. */
                interface $Properties {

                    /** StopTimeProperties assignedStopId */
                    assignedStopId?: (string|null);

                    /** StopTimeProperties stopHeadsign */
                    stopHeadsign?: (string|null);

                    /** StopTimeProperties pickupType */
                    pickupType?: (transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.DropOffPickupType|null);

                    /** StopTimeProperties dropOffType */
                    dropOffType?: (transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.DropOffPickupType|null);

                    /** Unknown fields preserved while decoding when enabled */
                    $unknowns?: Uint8Array[];
                }

                /** Shape of a StopTimeProperties. */
                type $Shape = transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties;

                /** DropOffPickupType enum. */
                enum DropOffPickupType {

                    /** REGULAR value */
                    REGULAR = 0,

                    /** NONE value */
                    NONE = 1,

                    /** PHONE_AGENCY value */
                    PHONE_AGENCY = 2,

                    /** COORDINATE_WITH_DRIVER value */
                    COORDINATE_WITH_DRIVER = 3
                }
            }
        }

        /**
         * Properties of a TripProperties.
         * @deprecated Use transit_realtime.TripUpdate.TripProperties.$Properties instead.
         */
        interface ITripProperties extends transit_realtime.TripUpdate.TripProperties.$Properties {
        }

        /** Represents a TripProperties. */
        class TripProperties {

            /**
             * Constructs a new TripProperties.
             * @param [properties] Properties to set
             */
            constructor(properties?: transit_realtime.TripUpdate.TripProperties.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** TripProperties tripId. */
            tripId: string;

            /** TripProperties startDate. */
            startDate: string;

            /** TripProperties startTime. */
            startTime: string;

            /** TripProperties shapeId. */
            shapeId: string;

            /** TripProperties tripHeadsign. */
            tripHeadsign: string;

            /** TripProperties tripShortName. */
            tripShortName: string;

            /**
             * Encodes the specified TripProperties message. Does not implicitly {@link transit_realtime.TripUpdate.TripProperties.verify|verify} messages.
             * @param message TripProperties message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: transit_realtime.TripUpdate.TripProperties.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a TripProperties message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {transit_realtime.TripUpdate.TripProperties & transit_realtime.TripUpdate.TripProperties.$Shape} TripProperties
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripUpdate.TripProperties & transit_realtime.TripUpdate.TripProperties.$Shape;

            /**
             * Gets the type url for TripProperties
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace TripProperties {

            /** Properties of a TripProperties. */
            interface $Properties {

                /** TripProperties tripId */
                tripId?: (string|null);

                /** TripProperties startDate */
                startDate?: (string|null);

                /** TripProperties startTime */
                startTime?: (string|null);

                /** TripProperties shapeId */
                shapeId?: (string|null);

                /** TripProperties tripHeadsign */
                tripHeadsign?: (string|null);

                /** TripProperties tripShortName */
                tripShortName?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a TripProperties. */
            type $Shape = transit_realtime.TripUpdate.TripProperties.$Properties;
        }
    }

    /**
     * Properties of a VehiclePosition.
     * @deprecated Use transit_realtime.VehiclePosition.$Properties instead.
     */
    interface IVehiclePosition extends transit_realtime.VehiclePosition.$Properties {
    }

    /** Represents a VehiclePosition. */
    class VehiclePosition {

        /**
         * Constructs a new VehiclePosition.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.VehiclePosition.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** VehiclePosition trip. */
        trip?: (transit_realtime.TripDescriptor.$Properties|null);

        /** VehiclePosition vehicle. */
        vehicle?: (transit_realtime.VehicleDescriptor.$Properties|null);

        /** VehiclePosition position. */
        position?: (transit_realtime.Position.$Properties|null);

        /** VehiclePosition currentStopSequence. */
        currentStopSequence: number;

        /** VehiclePosition stopId. */
        stopId: string;

        /** VehiclePosition currentStatus. */
        currentStatus: transit_realtime.VehiclePosition.VehicleStopStatus;

        /** VehiclePosition timestamp. */
        timestamp: (number|Long);

        /** VehiclePosition congestionLevel. */
        congestionLevel: transit_realtime.VehiclePosition.CongestionLevel;

        /** VehiclePosition occupancyStatus. */
        occupancyStatus: transit_realtime.VehiclePosition.OccupancyStatus;

        /** VehiclePosition occupancyPercentage. */
        occupancyPercentage: number;

        /** VehiclePosition multiCarriageDetails. */
        multiCarriageDetails: transit_realtime.VehiclePosition.CarriageDetails.$Properties[];

        /**
         * Encodes the specified VehiclePosition message. Does not implicitly {@link transit_realtime.VehiclePosition.verify|verify} messages.
         * @param message VehiclePosition message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.VehiclePosition.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a VehiclePosition message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.VehiclePosition & transit_realtime.VehiclePosition.$Shape} VehiclePosition
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.VehiclePosition & transit_realtime.VehiclePosition.$Shape;

        /**
         * Gets the type url for VehiclePosition
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace VehiclePosition {

        /** Properties of a VehiclePosition. */
        interface $Properties {

            /** VehiclePosition trip */
            trip?: (transit_realtime.TripDescriptor.$Properties|null);

            /** VehiclePosition vehicle */
            vehicle?: (transit_realtime.VehicleDescriptor.$Properties|null);

            /** VehiclePosition position */
            position?: (transit_realtime.Position.$Properties|null);

            /** VehiclePosition currentStopSequence */
            currentStopSequence?: (number|null);

            /** VehiclePosition stopId */
            stopId?: (string|null);

            /** VehiclePosition currentStatus */
            currentStatus?: (transit_realtime.VehiclePosition.VehicleStopStatus|null);

            /** VehiclePosition timestamp */
            timestamp?: (number|Long|null);

            /** VehiclePosition congestionLevel */
            congestionLevel?: (transit_realtime.VehiclePosition.CongestionLevel|null);

            /** VehiclePosition occupancyStatus */
            occupancyStatus?: (transit_realtime.VehiclePosition.OccupancyStatus|null);

            /** VehiclePosition occupancyPercentage */
            occupancyPercentage?: (number|null);

            /** VehiclePosition multiCarriageDetails */
            multiCarriageDetails?: (transit_realtime.VehiclePosition.CarriageDetails.$Properties[]|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a VehiclePosition. */
        type $Shape = transit_realtime.VehiclePosition.$Properties;

        /** VehicleStopStatus enum. */
        enum VehicleStopStatus {

            /** INCOMING_AT value */
            INCOMING_AT = 0,

            /** STOPPED_AT value */
            STOPPED_AT = 1,

            /** IN_TRANSIT_TO value */
            IN_TRANSIT_TO = 2
        }

        /** CongestionLevel enum. */
        enum CongestionLevel {

            /** UNKNOWN_CONGESTION_LEVEL value */
            UNKNOWN_CONGESTION_LEVEL = 0,

            /** RUNNING_SMOOTHLY value */
            RUNNING_SMOOTHLY = 1,

            /** STOP_AND_GO value */
            STOP_AND_GO = 2,

            /** CONGESTION value */
            CONGESTION = 3,

            /** SEVERE_CONGESTION value */
            SEVERE_CONGESTION = 4
        }

        /** OccupancyStatus enum. */
        enum OccupancyStatus {

            /** EMPTY value */
            EMPTY = 0,

            /** MANY_SEATS_AVAILABLE value */
            MANY_SEATS_AVAILABLE = 1,

            /** FEW_SEATS_AVAILABLE value */
            FEW_SEATS_AVAILABLE = 2,

            /** STANDING_ROOM_ONLY value */
            STANDING_ROOM_ONLY = 3,

            /** CRUSHED_STANDING_ROOM_ONLY value */
            CRUSHED_STANDING_ROOM_ONLY = 4,

            /** FULL value */
            FULL = 5,

            /** NOT_ACCEPTING_PASSENGERS value */
            NOT_ACCEPTING_PASSENGERS = 6,

            /** NO_DATA_AVAILABLE value */
            NO_DATA_AVAILABLE = 7,

            /** NOT_BOARDABLE value */
            NOT_BOARDABLE = 8
        }

        /**
         * Properties of a CarriageDetails.
         * @deprecated Use transit_realtime.VehiclePosition.CarriageDetails.$Properties instead.
         */
        interface ICarriageDetails extends transit_realtime.VehiclePosition.CarriageDetails.$Properties {
        }

        /** Represents a CarriageDetails. */
        class CarriageDetails {

            /**
             * Constructs a new CarriageDetails.
             * @param [properties] Properties to set
             */
            constructor(properties?: transit_realtime.VehiclePosition.CarriageDetails.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** CarriageDetails id. */
            id: string;

            /** CarriageDetails label. */
            label: string;

            /** CarriageDetails occupancyStatus. */
            occupancyStatus: transit_realtime.VehiclePosition.OccupancyStatus;

            /** CarriageDetails occupancyPercentage. */
            occupancyPercentage: number;

            /** CarriageDetails carriageSequence. */
            carriageSequence: number;

            /**
             * Encodes the specified CarriageDetails message. Does not implicitly {@link transit_realtime.VehiclePosition.CarriageDetails.verify|verify} messages.
             * @param message CarriageDetails message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: transit_realtime.VehiclePosition.CarriageDetails.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a CarriageDetails message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {transit_realtime.VehiclePosition.CarriageDetails & transit_realtime.VehiclePosition.CarriageDetails.$Shape} CarriageDetails
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.VehiclePosition.CarriageDetails & transit_realtime.VehiclePosition.CarriageDetails.$Shape;

            /**
             * Gets the type url for CarriageDetails
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace CarriageDetails {

            /** Properties of a CarriageDetails. */
            interface $Properties {

                /** CarriageDetails id */
                id?: (string|null);

                /** CarriageDetails label */
                label?: (string|null);

                /** CarriageDetails occupancyStatus */
                occupancyStatus?: (transit_realtime.VehiclePosition.OccupancyStatus|null);

                /** CarriageDetails occupancyPercentage */
                occupancyPercentage?: (number|null);

                /** CarriageDetails carriageSequence */
                carriageSequence?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a CarriageDetails. */
            type $Shape = transit_realtime.VehiclePosition.CarriageDetails.$Properties;
        }
    }

    /**
     * Properties of an Alert.
     * @deprecated Use transit_realtime.Alert.$Properties instead.
     */
    interface IAlert extends transit_realtime.Alert.$Properties {
    }

    /** Represents an Alert. */
    class Alert {

        /**
         * Constructs a new Alert.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.Alert.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** Alert activePeriod. */
        activePeriod: transit_realtime.TimeRange.$Properties[];

        /** Alert communicationPeriod. */
        communicationPeriod: transit_realtime.TimeRange.$Properties[];

        /** Alert impactPeriod. */
        impactPeriod: transit_realtime.TimeRange.$Properties[];

        /** Alert informedEntity. */
        informedEntity: transit_realtime.EntitySelector.$Properties[];

        /** Alert cause. */
        cause: transit_realtime.Alert.Cause;

        /** Alert effect. */
        effect: transit_realtime.Alert.Effect;

        /** Alert url. */
        url?: (transit_realtime.TranslatedString.$Properties|null);

        /** Alert headerText. */
        headerText?: (transit_realtime.TranslatedString.$Properties|null);

        /** Alert descriptionText. */
        descriptionText?: (transit_realtime.TranslatedString.$Properties|null);

        /** Alert ttsHeaderText. */
        ttsHeaderText?: (transit_realtime.TranslatedString.$Properties|null);

        /** Alert ttsDescriptionText. */
        ttsDescriptionText?: (transit_realtime.TranslatedString.$Properties|null);

        /** Alert severityLevel. */
        severityLevel: transit_realtime.Alert.SeverityLevel;

        /** Alert image. */
        image?: (transit_realtime.TranslatedImage.$Properties|null);

        /** Alert imageAlternativeText. */
        imageAlternativeText?: (transit_realtime.TranslatedString.$Properties|null);

        /** Alert causeDetail. */
        causeDetail?: (transit_realtime.TranslatedString.$Properties|null);

        /** Alert effectDetail. */
        effectDetail?: (transit_realtime.TranslatedString.$Properties|null);

        /**
         * Encodes the specified Alert message. Does not implicitly {@link transit_realtime.Alert.verify|verify} messages.
         * @param message Alert message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.Alert.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an Alert message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.Alert & transit_realtime.Alert.$Shape} Alert
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.Alert & transit_realtime.Alert.$Shape;

        /**
         * Gets the type url for Alert
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace Alert {

        /** Properties of an Alert. */
        interface $Properties {

            /** Alert activePeriod */
            activePeriod?: (transit_realtime.TimeRange.$Properties[]|null);

            /** Alert communicationPeriod */
            communicationPeriod?: (transit_realtime.TimeRange.$Properties[]|null);

            /** Alert impactPeriod */
            impactPeriod?: (transit_realtime.TimeRange.$Properties[]|null);

            /** Alert informedEntity */
            informedEntity?: (transit_realtime.EntitySelector.$Properties[]|null);

            /** Alert cause */
            cause?: (transit_realtime.Alert.Cause|null);

            /** Alert effect */
            effect?: (transit_realtime.Alert.Effect|null);

            /** Alert url */
            url?: (transit_realtime.TranslatedString.$Properties|null);

            /** Alert headerText */
            headerText?: (transit_realtime.TranslatedString.$Properties|null);

            /** Alert descriptionText */
            descriptionText?: (transit_realtime.TranslatedString.$Properties|null);

            /** Alert ttsHeaderText */
            ttsHeaderText?: (transit_realtime.TranslatedString.$Properties|null);

            /** Alert ttsDescriptionText */
            ttsDescriptionText?: (transit_realtime.TranslatedString.$Properties|null);

            /** Alert severityLevel */
            severityLevel?: (transit_realtime.Alert.SeverityLevel|null);

            /** Alert image */
            image?: (transit_realtime.TranslatedImage.$Properties|null);

            /** Alert imageAlternativeText */
            imageAlternativeText?: (transit_realtime.TranslatedString.$Properties|null);

            /** Alert causeDetail */
            causeDetail?: (transit_realtime.TranslatedString.$Properties|null);

            /** Alert effectDetail */
            effectDetail?: (transit_realtime.TranslatedString.$Properties|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of an Alert. */
        type $Shape = transit_realtime.Alert.$Properties;

        /** Cause enum. */
        enum Cause {

            /** UNKNOWN_CAUSE value */
            UNKNOWN_CAUSE = 1,

            /** OTHER_CAUSE value */
            OTHER_CAUSE = 2,

            /** TECHNICAL_PROBLEM value */
            TECHNICAL_PROBLEM = 3,

            /** STRIKE value */
            STRIKE = 4,

            /** DEMONSTRATION value */
            DEMONSTRATION = 5,

            /** ACCIDENT value */
            ACCIDENT = 6,

            /** HOLIDAY value */
            HOLIDAY = 7,

            /** WEATHER value */
            WEATHER = 8,

            /** MAINTENANCE value */
            MAINTENANCE = 9,

            /** CONSTRUCTION value */
            CONSTRUCTION = 10,

            /** POLICE_ACTIVITY value */
            POLICE_ACTIVITY = 11,

            /** MEDICAL_EMERGENCY value */
            MEDICAL_EMERGENCY = 12,

            /** SPECIAL_EVENT value */
            SPECIAL_EVENT = 13
        }

        /** Effect enum. */
        enum Effect {

            /** NO_SERVICE value */
            NO_SERVICE = 1,

            /** REDUCED_SERVICE value */
            REDUCED_SERVICE = 2,

            /** SIGNIFICANT_DELAYS value */
            SIGNIFICANT_DELAYS = 3,

            /** DETOUR value */
            DETOUR = 4,

            /** ADDITIONAL_SERVICE value */
            ADDITIONAL_SERVICE = 5,

            /** MODIFIED_SERVICE value */
            MODIFIED_SERVICE = 6,

            /** OTHER_EFFECT value */
            OTHER_EFFECT = 7,

            /** UNKNOWN_EFFECT value */
            UNKNOWN_EFFECT = 8,

            /** STOP_MOVED value */
            STOP_MOVED = 9,

            /** NO_EFFECT value */
            NO_EFFECT = 10,

            /** ACCESSIBILITY_ISSUE value */
            ACCESSIBILITY_ISSUE = 11
        }

        /** SeverityLevel enum. */
        enum SeverityLevel {

            /** UNKNOWN_SEVERITY value */
            UNKNOWN_SEVERITY = 1,

            /** INFO value */
            INFO = 2,

            /** WARNING value */
            WARNING = 3,

            /** SEVERE value */
            SEVERE = 4
        }
    }

    /**
     * Properties of a TimeRange.
     * @deprecated Use transit_realtime.TimeRange.$Properties instead.
     */
    interface ITimeRange extends transit_realtime.TimeRange.$Properties {
    }

    /** Represents a TimeRange. */
    class TimeRange {

        /**
         * Constructs a new TimeRange.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.TimeRange.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** TimeRange start. */
        start: (number|Long);

        /** TimeRange end. */
        end: (number|Long);

        /**
         * Encodes the specified TimeRange message. Does not implicitly {@link transit_realtime.TimeRange.verify|verify} messages.
         * @param message TimeRange message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.TimeRange.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a TimeRange message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.TimeRange & transit_realtime.TimeRange.$Shape} TimeRange
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TimeRange & transit_realtime.TimeRange.$Shape;

        /**
         * Gets the type url for TimeRange
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace TimeRange {

        /** Properties of a TimeRange. */
        interface $Properties {

            /** TimeRange start */
            start?: (number|Long|null);

            /** TimeRange end */
            end?: (number|Long|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a TimeRange. */
        type $Shape = transit_realtime.TimeRange.$Properties;
    }

    /**
     * Properties of a Position.
     * @deprecated Use transit_realtime.Position.$Properties instead.
     */
    interface IPosition extends transit_realtime.Position.$Properties {
    }

    /** Represents a Position. */
    class Position {

        /**
         * Constructs a new Position.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.Position.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** Position latitude. */
        latitude: number;

        /** Position longitude. */
        longitude: number;

        /** Position bearing. */
        bearing: number;

        /** Position odometer. */
        odometer: number;

        /** Position speed. */
        speed: number;

        /**
         * Encodes the specified Position message. Does not implicitly {@link transit_realtime.Position.verify|verify} messages.
         * @param message Position message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.Position.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Position message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.Position & transit_realtime.Position.$Shape} Position
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.Position & transit_realtime.Position.$Shape;

        /**
         * Gets the type url for Position
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace Position {

        /** Properties of a Position. */
        interface $Properties {

            /** Position latitude */
            latitude: number;

            /** Position longitude */
            longitude: number;

            /** Position bearing */
            bearing?: (number|null);

            /** Position odometer */
            odometer?: (number|null);

            /** Position speed */
            speed?: (number|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a Position. */
        type $Shape = transit_realtime.Position.$Properties;
    }

    /**
     * Properties of a TripDescriptor.
     * @deprecated Use transit_realtime.TripDescriptor.$Properties instead.
     */
    interface ITripDescriptor extends transit_realtime.TripDescriptor.$Properties {
    }

    /** Represents a TripDescriptor. */
    class TripDescriptor {

        /**
         * Constructs a new TripDescriptor.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.TripDescriptor.$Properties);

        /** TripDescriptor .transit_realtime.nyctTripDescriptor */
        ".transit_realtime.nyctTripDescriptor"?: (transit_realtime.NyctTripDescriptor.$Properties|null);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** TripDescriptor tripId. */
        tripId: string;

        /** TripDescriptor routeId. */
        routeId: string;

        /** TripDescriptor directionId. */
        directionId: number;

        /** TripDescriptor startTime. */
        startTime: string;

        /** TripDescriptor startDate. */
        startDate: string;

        /** TripDescriptor scheduleRelationship. */
        scheduleRelationship: transit_realtime.TripDescriptor.ScheduleRelationship;

        /** TripDescriptor modifiedTrip. */
        modifiedTrip?: (transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties|null);

        /**
         * Encodes the specified TripDescriptor message. Does not implicitly {@link transit_realtime.TripDescriptor.verify|verify} messages.
         * @param message TripDescriptor message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.TripDescriptor.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a TripDescriptor message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.TripDescriptor & transit_realtime.TripDescriptor.$Shape} TripDescriptor
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripDescriptor & transit_realtime.TripDescriptor.$Shape;

        /**
         * Gets the type url for TripDescriptor
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace TripDescriptor {

        /** Properties of a TripDescriptor. */
        interface $Properties {

            /** TripDescriptor tripId */
            tripId?: (string|null);

            /** TripDescriptor routeId */
            routeId?: (string|null);

            /** TripDescriptor directionId */
            directionId?: (number|null);

            /** TripDescriptor startTime */
            startTime?: (string|null);

            /** TripDescriptor startDate */
            startDate?: (string|null);

            /** TripDescriptor scheduleRelationship */
            scheduleRelationship?: (transit_realtime.TripDescriptor.ScheduleRelationship|null);

            /** TripDescriptor modifiedTrip */
            modifiedTrip?: (transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties|null);

            /** TripDescriptor .transit_realtime.nyctTripDescriptor */
            ".transit_realtime.nyctTripDescriptor"?: (transit_realtime.NyctTripDescriptor.$Properties|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a TripDescriptor. */
        type $Shape = transit_realtime.TripDescriptor.$Properties;

        /** ScheduleRelationship enum. */
        enum ScheduleRelationship {

            /** SCHEDULED value */
            SCHEDULED = 0,

            /** ADDED value */
            ADDED = 1,

            /** UNSCHEDULED value */
            UNSCHEDULED = 2,

            /** CANCELED value */
            CANCELED = 3,

            /** REPLACEMENT value */
            REPLACEMENT = 5,

            /** DUPLICATED value */
            DUPLICATED = 6,

            /** DELETED value */
            DELETED = 7,

            /** NEW value */
            NEW = 8
        }

        /**
         * Properties of a ModifiedTripSelector.
         * @deprecated Use transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties instead.
         */
        interface IModifiedTripSelector extends transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties {
        }

        /** Represents a ModifiedTripSelector. */
        class ModifiedTripSelector {

            /**
             * Constructs a new ModifiedTripSelector.
             * @param [properties] Properties to set
             */
            constructor(properties?: transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** ModifiedTripSelector modificationsId. */
            modificationsId: string;

            /** ModifiedTripSelector affectedTripId. */
            affectedTripId: string;

            /** ModifiedTripSelector startTime. */
            startTime: string;

            /** ModifiedTripSelector startDate. */
            startDate: string;

            /**
             * Encodes the specified ModifiedTripSelector message. Does not implicitly {@link transit_realtime.TripDescriptor.ModifiedTripSelector.verify|verify} messages.
             * @param message ModifiedTripSelector message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a ModifiedTripSelector message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {transit_realtime.TripDescriptor.ModifiedTripSelector & transit_realtime.TripDescriptor.ModifiedTripSelector.$Shape} ModifiedTripSelector
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripDescriptor.ModifiedTripSelector & transit_realtime.TripDescriptor.ModifiedTripSelector.$Shape;

            /**
             * Gets the type url for ModifiedTripSelector
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace ModifiedTripSelector {

            /** Properties of a ModifiedTripSelector. */
            interface $Properties {

                /** ModifiedTripSelector modificationsId */
                modificationsId?: (string|null);

                /** ModifiedTripSelector affectedTripId */
                affectedTripId?: (string|null);

                /** ModifiedTripSelector startTime */
                startTime?: (string|null);

                /** ModifiedTripSelector startDate */
                startDate?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a ModifiedTripSelector. */
            type $Shape = transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties;
        }
    }

    /**
     * Properties of a VehicleDescriptor.
     * @deprecated Use transit_realtime.VehicleDescriptor.$Properties instead.
     */
    interface IVehicleDescriptor extends transit_realtime.VehicleDescriptor.$Properties {
    }

    /** Represents a VehicleDescriptor. */
    class VehicleDescriptor {

        /**
         * Constructs a new VehicleDescriptor.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.VehicleDescriptor.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** VehicleDescriptor id. */
        id: string;

        /** VehicleDescriptor label. */
        label: string;

        /** VehicleDescriptor licensePlate. */
        licensePlate: string;

        /** VehicleDescriptor wheelchairAccessible. */
        wheelchairAccessible: transit_realtime.VehicleDescriptor.WheelchairAccessible;

        /**
         * Encodes the specified VehicleDescriptor message. Does not implicitly {@link transit_realtime.VehicleDescriptor.verify|verify} messages.
         * @param message VehicleDescriptor message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.VehicleDescriptor.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a VehicleDescriptor message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.VehicleDescriptor & transit_realtime.VehicleDescriptor.$Shape} VehicleDescriptor
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.VehicleDescriptor & transit_realtime.VehicleDescriptor.$Shape;

        /**
         * Gets the type url for VehicleDescriptor
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace VehicleDescriptor {

        /** Properties of a VehicleDescriptor. */
        interface $Properties {

            /** VehicleDescriptor id */
            id?: (string|null);

            /** VehicleDescriptor label */
            label?: (string|null);

            /** VehicleDescriptor licensePlate */
            licensePlate?: (string|null);

            /** VehicleDescriptor wheelchairAccessible */
            wheelchairAccessible?: (transit_realtime.VehicleDescriptor.WheelchairAccessible|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a VehicleDescriptor. */
        type $Shape = transit_realtime.VehicleDescriptor.$Properties;

        /** WheelchairAccessible enum. */
        enum WheelchairAccessible {

            /** NO_VALUE value */
            NO_VALUE = 0,

            /** UNKNOWN value */
            UNKNOWN = 1,

            /** WHEELCHAIR_ACCESSIBLE value */
            WHEELCHAIR_ACCESSIBLE = 2,

            /** WHEELCHAIR_INACCESSIBLE value */
            WHEELCHAIR_INACCESSIBLE = 3
        }
    }

    /**
     * Properties of an EntitySelector.
     * @deprecated Use transit_realtime.EntitySelector.$Properties instead.
     */
    interface IEntitySelector extends transit_realtime.EntitySelector.$Properties {
    }

    /** Represents an EntitySelector. */
    class EntitySelector {

        /**
         * Constructs a new EntitySelector.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.EntitySelector.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** EntitySelector agencyId. */
        agencyId: string;

        /** EntitySelector routeId. */
        routeId: string;

        /** EntitySelector routeType. */
        routeType: number;

        /** EntitySelector trip. */
        trip?: (transit_realtime.TripDescriptor.$Properties|null);

        /** EntitySelector stopId. */
        stopId: string;

        /** EntitySelector directionId. */
        directionId: number;

        /**
         * Encodes the specified EntitySelector message. Does not implicitly {@link transit_realtime.EntitySelector.verify|verify} messages.
         * @param message EntitySelector message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.EntitySelector.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an EntitySelector message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.EntitySelector & transit_realtime.EntitySelector.$Shape} EntitySelector
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.EntitySelector & transit_realtime.EntitySelector.$Shape;

        /**
         * Gets the type url for EntitySelector
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace EntitySelector {

        /** Properties of an EntitySelector. */
        interface $Properties {

            /** EntitySelector agencyId */
            agencyId?: (string|null);

            /** EntitySelector routeId */
            routeId?: (string|null);

            /** EntitySelector routeType */
            routeType?: (number|null);

            /** EntitySelector trip */
            trip?: (transit_realtime.TripDescriptor.$Properties|null);

            /** EntitySelector stopId */
            stopId?: (string|null);

            /** EntitySelector directionId */
            directionId?: (number|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of an EntitySelector. */
        type $Shape = transit_realtime.EntitySelector.$Properties;
    }

    /**
     * Properties of a TranslatedString.
     * @deprecated Use transit_realtime.TranslatedString.$Properties instead.
     */
    interface ITranslatedString extends transit_realtime.TranslatedString.$Properties {
    }

    /** Represents a TranslatedString. */
    class TranslatedString {

        /**
         * Constructs a new TranslatedString.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.TranslatedString.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** TranslatedString translation. */
        translation: transit_realtime.TranslatedString.Translation.$Properties[];

        /**
         * Encodes the specified TranslatedString message. Does not implicitly {@link transit_realtime.TranslatedString.verify|verify} messages.
         * @param message TranslatedString message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.TranslatedString.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a TranslatedString message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.TranslatedString & transit_realtime.TranslatedString.$Shape} TranslatedString
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TranslatedString & transit_realtime.TranslatedString.$Shape;

        /**
         * Gets the type url for TranslatedString
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace TranslatedString {

        /** Properties of a TranslatedString. */
        interface $Properties {

            /** TranslatedString translation */
            translation?: (transit_realtime.TranslatedString.Translation.$Properties[]|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a TranslatedString. */
        type $Shape = transit_realtime.TranslatedString.$Properties;

        /**
         * Properties of a Translation.
         * @deprecated Use transit_realtime.TranslatedString.Translation.$Properties instead.
         */
        interface ITranslation extends transit_realtime.TranslatedString.Translation.$Properties {
        }

        /** Represents a Translation. */
        class Translation {

            /**
             * Constructs a new Translation.
             * @param [properties] Properties to set
             */
            constructor(properties?: transit_realtime.TranslatedString.Translation.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** Translation text. */
            text: string;

            /** Translation language. */
            language: string;

            /**
             * Encodes the specified Translation message. Does not implicitly {@link transit_realtime.TranslatedString.Translation.verify|verify} messages.
             * @param message Translation message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: transit_realtime.TranslatedString.Translation.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a Translation message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {transit_realtime.TranslatedString.Translation & transit_realtime.TranslatedString.Translation.$Shape} Translation
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TranslatedString.Translation & transit_realtime.TranslatedString.Translation.$Shape;

            /**
             * Gets the type url for Translation
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace Translation {

            /** Properties of a Translation. */
            interface $Properties {

                /** Translation text */
                text: string;

                /** Translation language */
                language?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a Translation. */
            type $Shape = transit_realtime.TranslatedString.Translation.$Properties;
        }
    }

    /**
     * Properties of a TranslatedImage.
     * @deprecated Use transit_realtime.TranslatedImage.$Properties instead.
     */
    interface ITranslatedImage extends transit_realtime.TranslatedImage.$Properties {
    }

    /** Represents a TranslatedImage. */
    class TranslatedImage {

        /**
         * Constructs a new TranslatedImage.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.TranslatedImage.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** TranslatedImage localizedImage. */
        localizedImage: transit_realtime.TranslatedImage.LocalizedImage.$Properties[];

        /**
         * Encodes the specified TranslatedImage message. Does not implicitly {@link transit_realtime.TranslatedImage.verify|verify} messages.
         * @param message TranslatedImage message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.TranslatedImage.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a TranslatedImage message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.TranslatedImage & transit_realtime.TranslatedImage.$Shape} TranslatedImage
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TranslatedImage & transit_realtime.TranslatedImage.$Shape;

        /**
         * Gets the type url for TranslatedImage
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace TranslatedImage {

        /** Properties of a TranslatedImage. */
        interface $Properties {

            /** TranslatedImage localizedImage */
            localizedImage?: (transit_realtime.TranslatedImage.LocalizedImage.$Properties[]|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a TranslatedImage. */
        type $Shape = transit_realtime.TranslatedImage.$Properties;

        /**
         * Properties of a LocalizedImage.
         * @deprecated Use transit_realtime.TranslatedImage.LocalizedImage.$Properties instead.
         */
        interface ILocalizedImage extends transit_realtime.TranslatedImage.LocalizedImage.$Properties {
        }

        /** Represents a LocalizedImage. */
        class LocalizedImage {

            /**
             * Constructs a new LocalizedImage.
             * @param [properties] Properties to set
             */
            constructor(properties?: transit_realtime.TranslatedImage.LocalizedImage.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** LocalizedImage url. */
            url: string;

            /** LocalizedImage mediaType. */
            mediaType: string;

            /** LocalizedImage language. */
            language: string;

            /**
             * Encodes the specified LocalizedImage message. Does not implicitly {@link transit_realtime.TranslatedImage.LocalizedImage.verify|verify} messages.
             * @param message LocalizedImage message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: transit_realtime.TranslatedImage.LocalizedImage.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a LocalizedImage message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {transit_realtime.TranslatedImage.LocalizedImage & transit_realtime.TranslatedImage.LocalizedImage.$Shape} LocalizedImage
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TranslatedImage.LocalizedImage & transit_realtime.TranslatedImage.LocalizedImage.$Shape;

            /**
             * Gets the type url for LocalizedImage
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace LocalizedImage {

            /** Properties of a LocalizedImage. */
            interface $Properties {

                /** LocalizedImage url */
                url: string;

                /** LocalizedImage mediaType */
                mediaType: string;

                /** LocalizedImage language */
                language?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a LocalizedImage. */
            type $Shape = transit_realtime.TranslatedImage.LocalizedImage.$Properties;
        }
    }

    /**
     * Properties of a Shape.
     * @deprecated Use transit_realtime.Shape.$Properties instead.
     */
    interface IShape extends transit_realtime.Shape.$Properties {
    }

    /** Represents a Shape. */
    class Shape {

        /**
         * Constructs a new Shape.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.Shape.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** Shape shapeId. */
        shapeId: string;

        /** Shape encodedPolyline. */
        encodedPolyline: string;

        /**
         * Encodes the specified Shape message. Does not implicitly {@link transit_realtime.Shape.verify|verify} messages.
         * @param message Shape message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.Shape.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Shape message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.Shape & transit_realtime.Shape.$Shape} Shape
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.Shape & transit_realtime.Shape.$Shape;

        /**
         * Gets the type url for Shape
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace Shape {

        /** Properties of a Shape. */
        interface $Properties {

            /** Shape shapeId */
            shapeId?: (string|null);

            /** Shape encodedPolyline */
            encodedPolyline?: (string|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a Shape. */
        type $Shape = transit_realtime.Shape.$Properties;
    }

    /**
     * Properties of a Stop.
     * @deprecated Use transit_realtime.Stop.$Properties instead.
     */
    interface IStop extends transit_realtime.Stop.$Properties {
    }

    /** Represents a Stop. */
    class Stop {

        /**
         * Constructs a new Stop.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.Stop.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** Stop stopId. */
        stopId: string;

        /** Stop stopCode. */
        stopCode?: (transit_realtime.TranslatedString.$Properties|null);

        /** Stop stopName. */
        stopName?: (transit_realtime.TranslatedString.$Properties|null);

        /** Stop ttsStopName. */
        ttsStopName?: (transit_realtime.TranslatedString.$Properties|null);

        /** Stop stopDesc. */
        stopDesc?: (transit_realtime.TranslatedString.$Properties|null);

        /** Stop stopLat. */
        stopLat: number;

        /** Stop stopLon. */
        stopLon: number;

        /** Stop zoneId. */
        zoneId: string;

        /** Stop stopUrl. */
        stopUrl?: (transit_realtime.TranslatedString.$Properties|null);

        /** Stop parentStation. */
        parentStation: string;

        /** Stop stopTimezone. */
        stopTimezone: string;

        /** Stop wheelchairBoarding. */
        wheelchairBoarding: transit_realtime.Stop.WheelchairBoarding;

        /** Stop levelId. */
        levelId: string;

        /** Stop platformCode. */
        platformCode?: (transit_realtime.TranslatedString.$Properties|null);

        /**
         * Encodes the specified Stop message. Does not implicitly {@link transit_realtime.Stop.verify|verify} messages.
         * @param message Stop message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.Stop.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Stop message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.Stop & transit_realtime.Stop.$Shape} Stop
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.Stop & transit_realtime.Stop.$Shape;

        /**
         * Gets the type url for Stop
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace Stop {

        /** Properties of a Stop. */
        interface $Properties {

            /** Stop stopId */
            stopId?: (string|null);

            /** Stop stopCode */
            stopCode?: (transit_realtime.TranslatedString.$Properties|null);

            /** Stop stopName */
            stopName?: (transit_realtime.TranslatedString.$Properties|null);

            /** Stop ttsStopName */
            ttsStopName?: (transit_realtime.TranslatedString.$Properties|null);

            /** Stop stopDesc */
            stopDesc?: (transit_realtime.TranslatedString.$Properties|null);

            /** Stop stopLat */
            stopLat?: (number|null);

            /** Stop stopLon */
            stopLon?: (number|null);

            /** Stop zoneId */
            zoneId?: (string|null);

            /** Stop stopUrl */
            stopUrl?: (transit_realtime.TranslatedString.$Properties|null);

            /** Stop parentStation */
            parentStation?: (string|null);

            /** Stop stopTimezone */
            stopTimezone?: (string|null);

            /** Stop wheelchairBoarding */
            wheelchairBoarding?: (transit_realtime.Stop.WheelchairBoarding|null);

            /** Stop levelId */
            levelId?: (string|null);

            /** Stop platformCode */
            platformCode?: (transit_realtime.TranslatedString.$Properties|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a Stop. */
        type $Shape = transit_realtime.Stop.$Properties;

        /** WheelchairBoarding enum. */
        enum WheelchairBoarding {

            /** UNKNOWN value */
            UNKNOWN = 0,

            /** AVAILABLE value */
            AVAILABLE = 1,

            /** NOT_AVAILABLE value */
            NOT_AVAILABLE = 2
        }
    }

    /**
     * Properties of a TripModifications.
     * @deprecated Use transit_realtime.TripModifications.$Properties instead.
     */
    interface ITripModifications extends transit_realtime.TripModifications.$Properties {
    }

    /** Represents a TripModifications. */
    class TripModifications {

        /**
         * Constructs a new TripModifications.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.TripModifications.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** TripModifications selectedTrips. */
        selectedTrips: transit_realtime.TripModifications.SelectedTrips.$Properties[];

        /** TripModifications startTimes. */
        startTimes: string[];

        /** TripModifications serviceDates. */
        serviceDates: string[];

        /** TripModifications modifications. */
        modifications: transit_realtime.TripModifications.Modification.$Properties[];

        /**
         * Encodes the specified TripModifications message. Does not implicitly {@link transit_realtime.TripModifications.verify|verify} messages.
         * @param message TripModifications message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.TripModifications.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a TripModifications message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.TripModifications & transit_realtime.TripModifications.$Shape} TripModifications
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripModifications & transit_realtime.TripModifications.$Shape;

        /**
         * Gets the type url for TripModifications
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace TripModifications {

        /** Properties of a TripModifications. */
        interface $Properties {

            /** TripModifications selectedTrips */
            selectedTrips?: (transit_realtime.TripModifications.SelectedTrips.$Properties[]|null);

            /** TripModifications startTimes */
            startTimes?: (string[]|null);

            /** TripModifications serviceDates */
            serviceDates?: (string[]|null);

            /** TripModifications modifications */
            modifications?: (transit_realtime.TripModifications.Modification.$Properties[]|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a TripModifications. */
        type $Shape = transit_realtime.TripModifications.$Properties;

        /**
         * Properties of a Modification.
         * @deprecated Use transit_realtime.TripModifications.Modification.$Properties instead.
         */
        interface IModification extends transit_realtime.TripModifications.Modification.$Properties {
        }

        /** Represents a Modification. */
        class Modification {

            /**
             * Constructs a new Modification.
             * @param [properties] Properties to set
             */
            constructor(properties?: transit_realtime.TripModifications.Modification.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** Modification startStopSelector. */
            startStopSelector?: (transit_realtime.StopSelector.$Properties|null);

            /** Modification endStopSelector. */
            endStopSelector?: (transit_realtime.StopSelector.$Properties|null);

            /** Modification propagatedModificationDelay. */
            propagatedModificationDelay: number;

            /** Modification replacementStops. */
            replacementStops: transit_realtime.ReplacementStop.$Properties[];

            /** Modification serviceAlertId. */
            serviceAlertId: string;

            /** Modification lastModifiedTime. */
            lastModifiedTime: (number|Long);

            /**
             * Encodes the specified Modification message. Does not implicitly {@link transit_realtime.TripModifications.Modification.verify|verify} messages.
             * @param message Modification message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: transit_realtime.TripModifications.Modification.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a Modification message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {transit_realtime.TripModifications.Modification & transit_realtime.TripModifications.Modification.$Shape} Modification
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripModifications.Modification & transit_realtime.TripModifications.Modification.$Shape;

            /**
             * Gets the type url for Modification
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace Modification {

            /** Properties of a Modification. */
            interface $Properties {

                /** Modification startStopSelector */
                startStopSelector?: (transit_realtime.StopSelector.$Properties|null);

                /** Modification endStopSelector */
                endStopSelector?: (transit_realtime.StopSelector.$Properties|null);

                /** Modification propagatedModificationDelay */
                propagatedModificationDelay?: (number|null);

                /** Modification replacementStops */
                replacementStops?: (transit_realtime.ReplacementStop.$Properties[]|null);

                /** Modification serviceAlertId */
                serviceAlertId?: (string|null);

                /** Modification lastModifiedTime */
                lastModifiedTime?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a Modification. */
            type $Shape = transit_realtime.TripModifications.Modification.$Properties;
        }

        /**
         * Properties of a SelectedTrips.
         * @deprecated Use transit_realtime.TripModifications.SelectedTrips.$Properties instead.
         */
        interface ISelectedTrips extends transit_realtime.TripModifications.SelectedTrips.$Properties {
        }

        /** Represents a SelectedTrips. */
        class SelectedTrips {

            /**
             * Constructs a new SelectedTrips.
             * @param [properties] Properties to set
             */
            constructor(properties?: transit_realtime.TripModifications.SelectedTrips.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** SelectedTrips tripIds. */
            tripIds: string[];

            /** SelectedTrips shapeId. */
            shapeId: string;

            /**
             * Encodes the specified SelectedTrips message. Does not implicitly {@link transit_realtime.TripModifications.SelectedTrips.verify|verify} messages.
             * @param message SelectedTrips message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: transit_realtime.TripModifications.SelectedTrips.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a SelectedTrips message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {transit_realtime.TripModifications.SelectedTrips & transit_realtime.TripModifications.SelectedTrips.$Shape} SelectedTrips
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripModifications.SelectedTrips & transit_realtime.TripModifications.SelectedTrips.$Shape;

            /**
             * Gets the type url for SelectedTrips
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace SelectedTrips {

            /** Properties of a SelectedTrips. */
            interface $Properties {

                /** SelectedTrips tripIds */
                tripIds?: (string[]|null);

                /** SelectedTrips shapeId */
                shapeId?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a SelectedTrips. */
            type $Shape = transit_realtime.TripModifications.SelectedTrips.$Properties;
        }
    }

    /**
     * Properties of a StopSelector.
     * @deprecated Use transit_realtime.StopSelector.$Properties instead.
     */
    interface IStopSelector extends transit_realtime.StopSelector.$Properties {
    }

    /** Represents a StopSelector. */
    class StopSelector {

        /**
         * Constructs a new StopSelector.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.StopSelector.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** StopSelector stopSequence. */
        stopSequence: number;

        /** StopSelector stopId. */
        stopId: string;

        /**
         * Encodes the specified StopSelector message. Does not implicitly {@link transit_realtime.StopSelector.verify|verify} messages.
         * @param message StopSelector message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.StopSelector.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a StopSelector message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.StopSelector & transit_realtime.StopSelector.$Shape} StopSelector
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.StopSelector & transit_realtime.StopSelector.$Shape;

        /**
         * Gets the type url for StopSelector
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace StopSelector {

        /** Properties of a StopSelector. */
        interface $Properties {

            /** StopSelector stopSequence */
            stopSequence?: (number|null);

            /** StopSelector stopId */
            stopId?: (string|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a StopSelector. */
        type $Shape = transit_realtime.StopSelector.$Properties;
    }

    /**
     * Properties of a ReplacementStop.
     * @deprecated Use transit_realtime.ReplacementStop.$Properties instead.
     */
    interface IReplacementStop extends transit_realtime.ReplacementStop.$Properties {
    }

    /** Represents a ReplacementStop. */
    class ReplacementStop {

        /**
         * Constructs a new ReplacementStop.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.ReplacementStop.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** ReplacementStop travelTimeToStop. */
        travelTimeToStop: number;

        /** ReplacementStop stopId. */
        stopId: string;

        /**
         * Encodes the specified ReplacementStop message. Does not implicitly {@link transit_realtime.ReplacementStop.verify|verify} messages.
         * @param message ReplacementStop message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.ReplacementStop.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ReplacementStop message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.ReplacementStop & transit_realtime.ReplacementStop.$Shape} ReplacementStop
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.ReplacementStop & transit_realtime.ReplacementStop.$Shape;

        /**
         * Gets the type url for ReplacementStop
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace ReplacementStop {

        /** Properties of a ReplacementStop. */
        interface $Properties {

            /** ReplacementStop travelTimeToStop */
            travelTimeToStop?: (number|null);

            /** ReplacementStop stopId */
            stopId?: (string|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a ReplacementStop. */
        type $Shape = transit_realtime.ReplacementStop.$Properties;
    }

    /**
     * Properties of a TripReplacementPeriod.
     * @deprecated Use transit_realtime.TripReplacementPeriod.$Properties instead.
     */
    interface ITripReplacementPeriod extends transit_realtime.TripReplacementPeriod.$Properties {
    }

    /** Represents a TripReplacementPeriod. */
    class TripReplacementPeriod {

        /**
         * Constructs a new TripReplacementPeriod.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.TripReplacementPeriod.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** TripReplacementPeriod routeId. */
        routeId: string;

        /** TripReplacementPeriod replacementPeriod. */
        replacementPeriod?: (transit_realtime.TimeRange.$Properties|null);

        /**
         * Encodes the specified TripReplacementPeriod message. Does not implicitly {@link transit_realtime.TripReplacementPeriod.verify|verify} messages.
         * @param message TripReplacementPeriod message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.TripReplacementPeriod.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a TripReplacementPeriod message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.TripReplacementPeriod & transit_realtime.TripReplacementPeriod.$Shape} TripReplacementPeriod
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripReplacementPeriod & transit_realtime.TripReplacementPeriod.$Shape;

        /**
         * Gets the type url for TripReplacementPeriod
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace TripReplacementPeriod {

        /** Properties of a TripReplacementPeriod. */
        interface $Properties {

            /** TripReplacementPeriod routeId */
            routeId?: (string|null);

            /** TripReplacementPeriod replacementPeriod */
            replacementPeriod?: (transit_realtime.TimeRange.$Properties|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a TripReplacementPeriod. */
        type $Shape = transit_realtime.TripReplacementPeriod.$Properties;
    }

    /**
     * Properties of a NyctFeedHeader.
     * @deprecated Use transit_realtime.NyctFeedHeader.$Properties instead.
     */
    interface INyctFeedHeader extends transit_realtime.NyctFeedHeader.$Properties {
    }

    /** Represents a NyctFeedHeader. */
    class NyctFeedHeader {

        /**
         * Constructs a new NyctFeedHeader.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.NyctFeedHeader.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** NyctFeedHeader nyctSubwayVersion. */
        nyctSubwayVersion: string;

        /** NyctFeedHeader tripReplacementPeriod. */
        tripReplacementPeriod: transit_realtime.TripReplacementPeriod.$Properties[];

        /**
         * Encodes the specified NyctFeedHeader message. Does not implicitly {@link transit_realtime.NyctFeedHeader.verify|verify} messages.
         * @param message NyctFeedHeader message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.NyctFeedHeader.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a NyctFeedHeader message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.NyctFeedHeader & transit_realtime.NyctFeedHeader.$Shape} NyctFeedHeader
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.NyctFeedHeader & transit_realtime.NyctFeedHeader.$Shape;

        /**
         * Gets the type url for NyctFeedHeader
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace NyctFeedHeader {

        /** Properties of a NyctFeedHeader. */
        interface $Properties {

            /** NyctFeedHeader nyctSubwayVersion */
            nyctSubwayVersion: string;

            /** NyctFeedHeader tripReplacementPeriod */
            tripReplacementPeriod?: (transit_realtime.TripReplacementPeriod.$Properties[]|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a NyctFeedHeader. */
        type $Shape = transit_realtime.NyctFeedHeader.$Properties;
    }

    /**
     * Properties of a NyctTripDescriptor.
     * @deprecated Use transit_realtime.NyctTripDescriptor.$Properties instead.
     */
    interface INyctTripDescriptor extends transit_realtime.NyctTripDescriptor.$Properties {
    }

    /** Represents a NyctTripDescriptor. */
    class NyctTripDescriptor {

        /**
         * Constructs a new NyctTripDescriptor.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.NyctTripDescriptor.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** NyctTripDescriptor trainId. */
        trainId: string;

        /** NyctTripDescriptor isAssigned. */
        isAssigned: boolean;

        /** NyctTripDescriptor direction. */
        direction: transit_realtime.NyctTripDescriptor.Direction;

        /**
         * Encodes the specified NyctTripDescriptor message. Does not implicitly {@link transit_realtime.NyctTripDescriptor.verify|verify} messages.
         * @param message NyctTripDescriptor message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.NyctTripDescriptor.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a NyctTripDescriptor message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.NyctTripDescriptor & transit_realtime.NyctTripDescriptor.$Shape} NyctTripDescriptor
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.NyctTripDescriptor & transit_realtime.NyctTripDescriptor.$Shape;

        /**
         * Gets the type url for NyctTripDescriptor
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace NyctTripDescriptor {

        /** Properties of a NyctTripDescriptor. */
        interface $Properties {

            /** NyctTripDescriptor trainId */
            trainId?: (string|null);

            /** NyctTripDescriptor isAssigned */
            isAssigned?: (boolean|null);

            /** NyctTripDescriptor direction */
            direction?: (transit_realtime.NyctTripDescriptor.Direction|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a NyctTripDescriptor. */
        type $Shape = transit_realtime.NyctTripDescriptor.$Properties;

        /** Direction enum. */
        enum Direction {

            /** NORTH value */
            NORTH = 1,

            /** EAST value */
            EAST = 2,

            /** SOUTH value */
            SOUTH = 3,

            /** WEST value */
            WEST = 4
        }
    }

    /**
     * Properties of a NyctStopTimeUpdate.
     * @deprecated Use transit_realtime.NyctStopTimeUpdate.$Properties instead.
     */
    interface INyctStopTimeUpdate extends transit_realtime.NyctStopTimeUpdate.$Properties {
    }

    /** Represents a NyctStopTimeUpdate. */
    class NyctStopTimeUpdate {

        /**
         * Constructs a new NyctStopTimeUpdate.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.NyctStopTimeUpdate.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** NyctStopTimeUpdate scheduledTrack. */
        scheduledTrack: string;

        /** NyctStopTimeUpdate actualTrack. */
        actualTrack: string;

        /**
         * Encodes the specified NyctStopTimeUpdate message. Does not implicitly {@link transit_realtime.NyctStopTimeUpdate.verify|verify} messages.
         * @param message NyctStopTimeUpdate message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: transit_realtime.NyctStopTimeUpdate.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a NyctStopTimeUpdate message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.NyctStopTimeUpdate & transit_realtime.NyctStopTimeUpdate.$Shape} NyctStopTimeUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.NyctStopTimeUpdate & transit_realtime.NyctStopTimeUpdate.$Shape;

        /**
         * Gets the type url for NyctStopTimeUpdate
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace NyctStopTimeUpdate {

        /** Properties of a NyctStopTimeUpdate. */
        interface $Properties {

            /** NyctStopTimeUpdate scheduledTrack */
            scheduledTrack?: (string|null);

            /** NyctStopTimeUpdate actualTrack */
            actualTrack?: (string|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a NyctStopTimeUpdate. */
        type $Shape = transit_realtime.NyctStopTimeUpdate.$Properties;
    }
}
