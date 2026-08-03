/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-mixed-operators, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars, default-case, jsdoc/require-param*/
import $protobuf from "protobufjs/minimal.js";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;
const $Object = $util.global.Object, $undefined = $util.global.undefined, $Error = $util.global.Error;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const transit_realtime = $root.transit_realtime = (() => {

    /**
     * Namespace transit_realtime.
     * @exports transit_realtime
     * @namespace
     */
    const transit_realtime = {};

    transit_realtime.FeedMessage = (function() {

        /**
         * Properties of a FeedMessage.
         * @typedef {Object} transit_realtime.FeedMessage.$Properties
         * @property {transit_realtime.FeedHeader.$Properties} header FeedMessage header
         * @property {Array.<transit_realtime.FeedEntity.$Properties>|null} [entity] FeedMessage entity
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a FeedMessage.
         * @memberof transit_realtime
         * @interface IFeedMessage
         * @augments transit_realtime.FeedMessage.$Properties
         * @deprecated Use transit_realtime.FeedMessage.$Properties instead.
         */

        /**
         * Shape of a FeedMessage.
         * @typedef {transit_realtime.FeedMessage.$Properties} transit_realtime.FeedMessage.$Shape
         */

        /**
         * Constructs a new FeedMessage.
         * @memberof transit_realtime
         * @classdesc Represents a FeedMessage.
         * @constructor
         * @param {transit_realtime.FeedMessage.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const FeedMessage = function (properties) {
            this.entity = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * FeedMessage header.
         * @member {transit_realtime.FeedHeader.$Properties} header
         * @memberof transit_realtime.FeedMessage
         * @instance
         */
        FeedMessage.prototype.header = null;

        /**
         * FeedMessage entity.
         * @member {Array.<transit_realtime.FeedEntity.$Properties>} entity
         * @memberof transit_realtime.FeedMessage
         * @instance
         */
        FeedMessage.prototype.entity = $util.emptyArray;

        /**
         * Encodes the specified FeedMessage message. Does not implicitly {@link transit_realtime.FeedMessage.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.FeedMessage
         * @static
         * @param {transit_realtime.FeedMessage.$Properties} message FeedMessage message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        FeedMessage.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            $root.transit_realtime.FeedHeader.encode(message.header, writer.uint32(/* id 1, wireType 2 =*/10).fork(), _depth + 1).ldelim();
            if (message.entity != null && message.entity.length)
                for (let i = 0; i < message.entity.length; ++i)
                    $root.transit_realtime.FeedEntity.encode(message.entity[i], writer.uint32(/* id 2, wireType 2 =*/18).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a FeedMessage message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.FeedMessage
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.FeedMessage & transit_realtime.FeedMessage.$Shape} FeedMessage
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        FeedMessage.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.FeedMessage();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        message.header = $root.transit_realtime.FeedHeader.decode(reader, reader.uint32(), $undefined, _depth + 1, message.header);
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if (!(message.entity && message.entity.length))
                            message.entity = [];
                        message.entity.push($root.transit_realtime.FeedEntity.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            if (!$Object.hasOwnProperty.call(message, "header"))
                throw $util.ProtocolError("missing required 'header'", { instance: message });
            return message;
        };

        /**
         * Gets the type url for FeedMessage
         * @function getTypeUrl
         * @memberof transit_realtime.FeedMessage
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        FeedMessage.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.FeedMessage";
        };

        return FeedMessage;
    })();

    transit_realtime.FeedHeader = (function() {

        /**
         * Properties of a FeedHeader.
         * @typedef {Object} transit_realtime.FeedHeader.$Properties
         * @property {string} gtfsRealtimeVersion FeedHeader gtfsRealtimeVersion
         * @property {transit_realtime.FeedHeader.Incrementality|null} [incrementality] FeedHeader incrementality
         * @property {number|Long|null} [timestamp] FeedHeader timestamp
         * @property {string|null} [feedVersion] FeedHeader feedVersion
         * @property {transit_realtime.NyctFeedHeader.$Properties|null} [".transit_realtime.nyctFeedHeader"] FeedHeader .transit_realtime.nyctFeedHeader
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a FeedHeader.
         * @memberof transit_realtime
         * @interface IFeedHeader
         * @augments transit_realtime.FeedHeader.$Properties
         * @deprecated Use transit_realtime.FeedHeader.$Properties instead.
         */

        /**
         * Shape of a FeedHeader.
         * @typedef {transit_realtime.FeedHeader.$Properties} transit_realtime.FeedHeader.$Shape
         */

        /**
         * Constructs a new FeedHeader.
         * @memberof transit_realtime
         * @classdesc Represents a FeedHeader.
         * @constructor
         * @param {transit_realtime.FeedHeader.$Properties=} [properties] Properties to set
         * @property {transit_realtime.NyctFeedHeader.$Properties|null} [".transit_realtime.nyctFeedHeader"] FeedHeader .transit_realtime.nyctFeedHeader
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const FeedHeader = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * FeedHeader gtfsRealtimeVersion.
         * @member {string} gtfsRealtimeVersion
         * @memberof transit_realtime.FeedHeader
         * @instance
         */
        FeedHeader.prototype.gtfsRealtimeVersion = "";

        /**
         * FeedHeader incrementality.
         * @member {transit_realtime.FeedHeader.Incrementality} incrementality
         * @memberof transit_realtime.FeedHeader
         * @instance
         */
        FeedHeader.prototype.incrementality = 0;

        /**
         * FeedHeader timestamp.
         * @member {number|Long} timestamp
         * @memberof transit_realtime.FeedHeader
         * @instance
         */
        FeedHeader.prototype.timestamp = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * FeedHeader feedVersion.
         * @member {string} feedVersion
         * @memberof transit_realtime.FeedHeader
         * @instance
         */
        FeedHeader.prototype.feedVersion = "";

        FeedHeader.prototype[".transit_realtime.nyctFeedHeader"] = null;

        /**
         * Encodes the specified FeedHeader message. Does not implicitly {@link transit_realtime.FeedHeader.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.FeedHeader
         * @static
         * @param {transit_realtime.FeedHeader.$Properties} message FeedHeader message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        FeedHeader.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            writer.uint32(/* id 1, wireType 2 =*/10).string(message.gtfsRealtimeVersion);
            if (message.incrementality != null && $Object.hasOwnProperty.call(message, "incrementality"))
                writer.uint32(/* id 2, wireType 0 =*/16).int32(message.incrementality);
            if (message.timestamp != null && $Object.hasOwnProperty.call(message, "timestamp"))
                writer.uint32(/* id 3, wireType 0 =*/24).uint64(message.timestamp);
            if (message.feedVersion != null && $Object.hasOwnProperty.call(message, "feedVersion"))
                writer.uint32(/* id 4, wireType 2 =*/34).string(message.feedVersion);
            if (message[".transit_realtime.nyctFeedHeader"] != null && $Object.hasOwnProperty.call(message, ".transit_realtime.nyctFeedHeader"))
                $root.transit_realtime.NyctFeedHeader.encode(message[".transit_realtime.nyctFeedHeader"], writer.uint32(/* id 1001, wireType 2 =*/8010).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a FeedHeader message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.FeedHeader
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.FeedHeader & transit_realtime.FeedHeader.$Shape} FeedHeader
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        FeedHeader.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.FeedHeader(), value;
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        message.gtfsRealtimeVersion = reader.string();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        value = reader.int32();
                        if ($root.transit_realtime.FeedHeader.Incrementality[value] !== $undefined)
                            message.incrementality = value;
                        else if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                        continue;
                    }
                case 3: {
                        if (wireType !== 0)
                            break;
                        message.timestamp = reader.uint64();
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        message.feedVersion = reader.string();
                        continue;
                    }
                case 1001: {
                        if (wireType !== 2)
                            break;
                        message[".transit_realtime.nyctFeedHeader"] = $root.transit_realtime.NyctFeedHeader.decode(reader, reader.uint32(), $undefined, _depth + 1, message[".transit_realtime.nyctFeedHeader"]);
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            if (!$Object.hasOwnProperty.call(message, "gtfsRealtimeVersion"))
                throw $util.ProtocolError("missing required 'gtfsRealtimeVersion'", { instance: message });
            return message;
        };

        /**
         * Gets the type url for FeedHeader
         * @function getTypeUrl
         * @memberof transit_realtime.FeedHeader
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        FeedHeader.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.FeedHeader";
        };

        /**
         * Incrementality enum.
         * @name transit_realtime.FeedHeader.Incrementality
         * @enum {number}
         * @property {number} FULL_DATASET=0 FULL_DATASET value
         * @property {number} DIFFERENTIAL=1 DIFFERENTIAL value
         */
        FeedHeader.Incrementality = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[0] = "FULL_DATASET"] = 0;
            values[valuesById[1] = "DIFFERENTIAL"] = 1;
            return values;
        })();

        return FeedHeader;
    })();

    transit_realtime.FeedEntity = (function() {

        /**
         * Properties of a FeedEntity.
         * @typedef {Object} transit_realtime.FeedEntity.$Properties
         * @property {string} id FeedEntity id
         * @property {boolean|null} [isDeleted] FeedEntity isDeleted
         * @property {transit_realtime.TripUpdate.$Properties|null} [tripUpdate] FeedEntity tripUpdate
         * @property {transit_realtime.VehiclePosition.$Properties|null} [vehicle] FeedEntity vehicle
         * @property {transit_realtime.Alert.$Properties|null} [alert] FeedEntity alert
         * @property {transit_realtime.Shape.$Properties|null} [shape] FeedEntity shape
         * @property {transit_realtime.Stop.$Properties|null} [stop] FeedEntity stop
         * @property {transit_realtime.TripModifications.$Properties|null} [tripModifications] FeedEntity tripModifications
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a FeedEntity.
         * @memberof transit_realtime
         * @interface IFeedEntity
         * @augments transit_realtime.FeedEntity.$Properties
         * @deprecated Use transit_realtime.FeedEntity.$Properties instead.
         */

        /**
         * Shape of a FeedEntity.
         * @typedef {transit_realtime.FeedEntity.$Properties} transit_realtime.FeedEntity.$Shape
         */

        /**
         * Constructs a new FeedEntity.
         * @memberof transit_realtime
         * @classdesc Represents a FeedEntity.
         * @constructor
         * @param {transit_realtime.FeedEntity.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const FeedEntity = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * FeedEntity id.
         * @member {string} id
         * @memberof transit_realtime.FeedEntity
         * @instance
         */
        FeedEntity.prototype.id = "";

        /**
         * FeedEntity isDeleted.
         * @member {boolean} isDeleted
         * @memberof transit_realtime.FeedEntity
         * @instance
         */
        FeedEntity.prototype.isDeleted = false;

        /**
         * FeedEntity tripUpdate.
         * @member {transit_realtime.TripUpdate.$Properties|null|undefined} tripUpdate
         * @memberof transit_realtime.FeedEntity
         * @instance
         */
        FeedEntity.prototype.tripUpdate = null;

        /**
         * FeedEntity vehicle.
         * @member {transit_realtime.VehiclePosition.$Properties|null|undefined} vehicle
         * @memberof transit_realtime.FeedEntity
         * @instance
         */
        FeedEntity.prototype.vehicle = null;

        /**
         * FeedEntity alert.
         * @member {transit_realtime.Alert.$Properties|null|undefined} alert
         * @memberof transit_realtime.FeedEntity
         * @instance
         */
        FeedEntity.prototype.alert = null;

        /**
         * FeedEntity shape.
         * @member {transit_realtime.Shape.$Properties|null|undefined} shape
         * @memberof transit_realtime.FeedEntity
         * @instance
         */
        FeedEntity.prototype.shape = null;

        /**
         * FeedEntity stop.
         * @member {transit_realtime.Stop.$Properties|null|undefined} stop
         * @memberof transit_realtime.FeedEntity
         * @instance
         */
        FeedEntity.prototype.stop = null;

        /**
         * FeedEntity tripModifications.
         * @member {transit_realtime.TripModifications.$Properties|null|undefined} tripModifications
         * @memberof transit_realtime.FeedEntity
         * @instance
         */
        FeedEntity.prototype.tripModifications = null;

        /**
         * Encodes the specified FeedEntity message. Does not implicitly {@link transit_realtime.FeedEntity.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.FeedEntity
         * @static
         * @param {transit_realtime.FeedEntity.$Properties} message FeedEntity message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        FeedEntity.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            writer.uint32(/* id 1, wireType 2 =*/10).string(message.id);
            if (message.isDeleted != null && $Object.hasOwnProperty.call(message, "isDeleted"))
                writer.uint32(/* id 2, wireType 0 =*/16).bool(message.isDeleted);
            if (message.tripUpdate != null && $Object.hasOwnProperty.call(message, "tripUpdate"))
                $root.transit_realtime.TripUpdate.encode(message.tripUpdate, writer.uint32(/* id 3, wireType 2 =*/26).fork(), _depth + 1).ldelim();
            if (message.vehicle != null && $Object.hasOwnProperty.call(message, "vehicle"))
                $root.transit_realtime.VehiclePosition.encode(message.vehicle, writer.uint32(/* id 4, wireType 2 =*/34).fork(), _depth + 1).ldelim();
            if (message.alert != null && $Object.hasOwnProperty.call(message, "alert"))
                $root.transit_realtime.Alert.encode(message.alert, writer.uint32(/* id 5, wireType 2 =*/42).fork(), _depth + 1).ldelim();
            if (message.shape != null && $Object.hasOwnProperty.call(message, "shape"))
                $root.transit_realtime.Shape.encode(message.shape, writer.uint32(/* id 6, wireType 2 =*/50).fork(), _depth + 1).ldelim();
            if (message.stop != null && $Object.hasOwnProperty.call(message, "stop"))
                $root.transit_realtime.Stop.encode(message.stop, writer.uint32(/* id 7, wireType 2 =*/58).fork(), _depth + 1).ldelim();
            if (message.tripModifications != null && $Object.hasOwnProperty.call(message, "tripModifications"))
                $root.transit_realtime.TripModifications.encode(message.tripModifications, writer.uint32(/* id 8, wireType 2 =*/66).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a FeedEntity message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.FeedEntity
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.FeedEntity & transit_realtime.FeedEntity.$Shape} FeedEntity
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        FeedEntity.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.FeedEntity();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        message.id = reader.string();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.isDeleted = reader.bool();
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.tripUpdate = $root.transit_realtime.TripUpdate.decode(reader, reader.uint32(), $undefined, _depth + 1, message.tripUpdate);
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        message.vehicle = $root.transit_realtime.VehiclePosition.decode(reader, reader.uint32(), $undefined, _depth + 1, message.vehicle);
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        message.alert = $root.transit_realtime.Alert.decode(reader, reader.uint32(), $undefined, _depth + 1, message.alert);
                        continue;
                    }
                case 6: {
                        if (wireType !== 2)
                            break;
                        message.shape = $root.transit_realtime.Shape.decode(reader, reader.uint32(), $undefined, _depth + 1, message.shape);
                        continue;
                    }
                case 7: {
                        if (wireType !== 2)
                            break;
                        message.stop = $root.transit_realtime.Stop.decode(reader, reader.uint32(), $undefined, _depth + 1, message.stop);
                        continue;
                    }
                case 8: {
                        if (wireType !== 2)
                            break;
                        message.tripModifications = $root.transit_realtime.TripModifications.decode(reader, reader.uint32(), $undefined, _depth + 1, message.tripModifications);
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            if (!$Object.hasOwnProperty.call(message, "id"))
                throw $util.ProtocolError("missing required 'id'", { instance: message });
            return message;
        };

        /**
         * Gets the type url for FeedEntity
         * @function getTypeUrl
         * @memberof transit_realtime.FeedEntity
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        FeedEntity.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.FeedEntity";
        };

        return FeedEntity;
    })();

    transit_realtime.TripUpdate = (function() {

        /**
         * Properties of a TripUpdate.
         * @typedef {Object} transit_realtime.TripUpdate.$Properties
         * @property {transit_realtime.TripDescriptor.$Properties} trip TripUpdate trip
         * @property {transit_realtime.VehicleDescriptor.$Properties|null} [vehicle] TripUpdate vehicle
         * @property {Array.<transit_realtime.TripUpdate.StopTimeUpdate.$Properties>|null} [stopTimeUpdate] TripUpdate stopTimeUpdate
         * @property {number|Long|null} [timestamp] TripUpdate timestamp
         * @property {number|null} [delay] TripUpdate delay
         * @property {transit_realtime.TripUpdate.TripProperties.$Properties|null} [tripProperties] TripUpdate tripProperties
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a TripUpdate.
         * @memberof transit_realtime
         * @interface ITripUpdate
         * @augments transit_realtime.TripUpdate.$Properties
         * @deprecated Use transit_realtime.TripUpdate.$Properties instead.
         */

        /**
         * Shape of a TripUpdate.
         * @typedef {transit_realtime.TripUpdate.$Properties} transit_realtime.TripUpdate.$Shape
         */

        /**
         * Constructs a new TripUpdate.
         * @memberof transit_realtime
         * @classdesc Represents a TripUpdate.
         * @constructor
         * @param {transit_realtime.TripUpdate.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const TripUpdate = function (properties) {
            this.stopTimeUpdate = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * TripUpdate trip.
         * @member {transit_realtime.TripDescriptor.$Properties} trip
         * @memberof transit_realtime.TripUpdate
         * @instance
         */
        TripUpdate.prototype.trip = null;

        /**
         * TripUpdate vehicle.
         * @member {transit_realtime.VehicleDescriptor.$Properties|null|undefined} vehicle
         * @memberof transit_realtime.TripUpdate
         * @instance
         */
        TripUpdate.prototype.vehicle = null;

        /**
         * TripUpdate stopTimeUpdate.
         * @member {Array.<transit_realtime.TripUpdate.StopTimeUpdate.$Properties>} stopTimeUpdate
         * @memberof transit_realtime.TripUpdate
         * @instance
         */
        TripUpdate.prototype.stopTimeUpdate = $util.emptyArray;

        /**
         * TripUpdate timestamp.
         * @member {number|Long} timestamp
         * @memberof transit_realtime.TripUpdate
         * @instance
         */
        TripUpdate.prototype.timestamp = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * TripUpdate delay.
         * @member {number} delay
         * @memberof transit_realtime.TripUpdate
         * @instance
         */
        TripUpdate.prototype.delay = 0;

        /**
         * TripUpdate tripProperties.
         * @member {transit_realtime.TripUpdate.TripProperties.$Properties|null|undefined} tripProperties
         * @memberof transit_realtime.TripUpdate
         * @instance
         */
        TripUpdate.prototype.tripProperties = null;

        /**
         * Encodes the specified TripUpdate message. Does not implicitly {@link transit_realtime.TripUpdate.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.TripUpdate
         * @static
         * @param {transit_realtime.TripUpdate.$Properties} message TripUpdate message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        TripUpdate.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            $root.transit_realtime.TripDescriptor.encode(message.trip, writer.uint32(/* id 1, wireType 2 =*/10).fork(), _depth + 1).ldelim();
            if (message.stopTimeUpdate != null && message.stopTimeUpdate.length)
                for (let i = 0; i < message.stopTimeUpdate.length; ++i)
                    $root.transit_realtime.TripUpdate.StopTimeUpdate.encode(message.stopTimeUpdate[i], writer.uint32(/* id 2, wireType 2 =*/18).fork(), _depth + 1).ldelim();
            if (message.vehicle != null && $Object.hasOwnProperty.call(message, "vehicle"))
                $root.transit_realtime.VehicleDescriptor.encode(message.vehicle, writer.uint32(/* id 3, wireType 2 =*/26).fork(), _depth + 1).ldelim();
            if (message.timestamp != null && $Object.hasOwnProperty.call(message, "timestamp"))
                writer.uint32(/* id 4, wireType 0 =*/32).uint64(message.timestamp);
            if (message.delay != null && $Object.hasOwnProperty.call(message, "delay"))
                writer.uint32(/* id 5, wireType 0 =*/40).int32(message.delay);
            if (message.tripProperties != null && $Object.hasOwnProperty.call(message, "tripProperties"))
                $root.transit_realtime.TripUpdate.TripProperties.encode(message.tripProperties, writer.uint32(/* id 6, wireType 2 =*/50).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a TripUpdate message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.TripUpdate
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.TripUpdate & transit_realtime.TripUpdate.$Shape} TripUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        TripUpdate.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TripUpdate();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        message.trip = $root.transit_realtime.TripDescriptor.decode(reader, reader.uint32(), $undefined, _depth + 1, message.trip);
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.vehicle = $root.transit_realtime.VehicleDescriptor.decode(reader, reader.uint32(), $undefined, _depth + 1, message.vehicle);
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if (!(message.stopTimeUpdate && message.stopTimeUpdate.length))
                            message.stopTimeUpdate = [];
                        message.stopTimeUpdate.push($root.transit_realtime.TripUpdate.StopTimeUpdate.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        message.timestamp = reader.uint64();
                        continue;
                    }
                case 5: {
                        if (wireType !== 0)
                            break;
                        message.delay = reader.int32();
                        continue;
                    }
                case 6: {
                        if (wireType !== 2)
                            break;
                        message.tripProperties = $root.transit_realtime.TripUpdate.TripProperties.decode(reader, reader.uint32(), $undefined, _depth + 1, message.tripProperties);
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            if (!$Object.hasOwnProperty.call(message, "trip"))
                throw $util.ProtocolError("missing required 'trip'", { instance: message });
            return message;
        };

        /**
         * Gets the type url for TripUpdate
         * @function getTypeUrl
         * @memberof transit_realtime.TripUpdate
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        TripUpdate.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.TripUpdate";
        };

        TripUpdate.StopTimeEvent = (function() {

            /**
             * Properties of a StopTimeEvent.
             * @typedef {Object} transit_realtime.TripUpdate.StopTimeEvent.$Properties
             * @property {number|null} [delay] StopTimeEvent delay
             * @property {number|Long|null} [time] StopTimeEvent time
             * @property {number|null} [uncertainty] StopTimeEvent uncertainty
             * @property {number|Long|null} [scheduledTime] StopTimeEvent scheduledTime
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */

            /**
             * Properties of a StopTimeEvent.
             * @memberof transit_realtime.TripUpdate
             * @interface IStopTimeEvent
             * @augments transit_realtime.TripUpdate.StopTimeEvent.$Properties
             * @deprecated Use transit_realtime.TripUpdate.StopTimeEvent.$Properties instead.
             */

            /**
             * Shape of a StopTimeEvent.
             * @typedef {transit_realtime.TripUpdate.StopTimeEvent.$Properties} transit_realtime.TripUpdate.StopTimeEvent.$Shape
             */

            /**
             * Constructs a new StopTimeEvent.
             * @memberof transit_realtime.TripUpdate
             * @classdesc Represents a StopTimeEvent.
             * @constructor
             * @param {transit_realtime.TripUpdate.StopTimeEvent.$Properties=} [properties] Properties to set
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */
            const StopTimeEvent = function (properties) {
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            /**
             * StopTimeEvent delay.
             * @member {number} delay
             * @memberof transit_realtime.TripUpdate.StopTimeEvent
             * @instance
             */
            StopTimeEvent.prototype.delay = 0;

            /**
             * StopTimeEvent time.
             * @member {number|Long} time
             * @memberof transit_realtime.TripUpdate.StopTimeEvent
             * @instance
             */
            StopTimeEvent.prototype.time = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

            /**
             * StopTimeEvent uncertainty.
             * @member {number} uncertainty
             * @memberof transit_realtime.TripUpdate.StopTimeEvent
             * @instance
             */
            StopTimeEvent.prototype.uncertainty = 0;

            /**
             * StopTimeEvent scheduledTime.
             * @member {number|Long} scheduledTime
             * @memberof transit_realtime.TripUpdate.StopTimeEvent
             * @instance
             */
            StopTimeEvent.prototype.scheduledTime = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

            /**
             * Encodes the specified StopTimeEvent message. Does not implicitly {@link transit_realtime.TripUpdate.StopTimeEvent.verify|verify} messages.
             * @function encode
             * @memberof transit_realtime.TripUpdate.StopTimeEvent
             * @static
             * @param {transit_realtime.TripUpdate.StopTimeEvent.$Properties} message StopTimeEvent message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            StopTimeEvent.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (message.delay != null && $Object.hasOwnProperty.call(message, "delay"))
                    writer.uint32(/* id 1, wireType 0 =*/8).int32(message.delay);
                if (message.time != null && $Object.hasOwnProperty.call(message, "time"))
                    writer.uint32(/* id 2, wireType 0 =*/16).int64(message.time);
                if (message.uncertainty != null && $Object.hasOwnProperty.call(message, "uncertainty"))
                    writer.uint32(/* id 3, wireType 0 =*/24).int32(message.uncertainty);
                if (message.scheduledTime != null && $Object.hasOwnProperty.call(message, "scheduledTime"))
                    writer.uint32(/* id 4, wireType 0 =*/32).int64(message.scheduledTime);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            /**
             * Decodes a StopTimeEvent message from the specified reader or buffer.
             * @function decode
             * @memberof transit_realtime.TripUpdate.StopTimeEvent
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {transit_realtime.TripUpdate.StopTimeEvent & transit_realtime.TripUpdate.StopTimeEvent.$Shape} StopTimeEvent
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            StopTimeEvent.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TripUpdate.StopTimeEvent();
                while (reader.pos < end) {
                    let start = reader.pos;
                    let tag = reader.tag();
                    if (tag === _end) {
                        _end = $undefined;
                        break;
                    }
                    let wireType = tag & 7;
                    switch (tag >>>= 3) {
                    case 1: {
                            if (wireType !== 0)
                                break;
                            message.delay = reader.int32();
                            continue;
                        }
                    case 2: {
                            if (wireType !== 0)
                                break;
                            message.time = reader.int64();
                            continue;
                        }
                    case 3: {
                            if (wireType !== 0)
                                break;
                            message.uncertainty = reader.int32();
                            continue;
                        }
                    case 4: {
                            if (wireType !== 0)
                                break;
                            message.scheduledTime = reader.int64();
                            continue;
                        }
                    }
                    reader.skipType(wireType, _depth, tag);
                    if (!reader.discardUnknown) {
                        $util.makeProp(message, "$unknowns", false);
                        (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                    }
                }
                if (_end !== $undefined)
                    throw $Error("missing end group");
                return message;
            };

            /**
             * Gets the type url for StopTimeEvent
             * @function getTypeUrl
             * @memberof transit_realtime.TripUpdate.StopTimeEvent
             * @static
             * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns {string} The type url
             */
            StopTimeEvent.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/transit_realtime.TripUpdate.StopTimeEvent";
            };

            return StopTimeEvent;
        })();

        TripUpdate.StopTimeUpdate = (function() {

            /**
             * Properties of a StopTimeUpdate.
             * @typedef {Object} transit_realtime.TripUpdate.StopTimeUpdate.$Properties
             * @property {number|null} [stopSequence] StopTimeUpdate stopSequence
             * @property {string|null} [stopId] StopTimeUpdate stopId
             * @property {transit_realtime.TripUpdate.StopTimeEvent.$Properties|null} [arrival] StopTimeUpdate arrival
             * @property {transit_realtime.TripUpdate.StopTimeEvent.$Properties|null} [departure] StopTimeUpdate departure
             * @property {transit_realtime.VehiclePosition.OccupancyStatus|null} [departureOccupancyStatus] StopTimeUpdate departureOccupancyStatus
             * @property {transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship|null} [scheduleRelationship] StopTimeUpdate scheduleRelationship
             * @property {transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties|null} [stopTimeProperties] StopTimeUpdate stopTimeProperties
             * @property {transit_realtime.NyctStopTimeUpdate.$Properties|null} [".transit_realtime.nyctStopTimeUpdate"] StopTimeUpdate .transit_realtime.nyctStopTimeUpdate
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */

            /**
             * Properties of a StopTimeUpdate.
             * @memberof transit_realtime.TripUpdate
             * @interface IStopTimeUpdate
             * @augments transit_realtime.TripUpdate.StopTimeUpdate.$Properties
             * @deprecated Use transit_realtime.TripUpdate.StopTimeUpdate.$Properties instead.
             */

            /**
             * Shape of a StopTimeUpdate.
             * @typedef {transit_realtime.TripUpdate.StopTimeUpdate.$Properties} transit_realtime.TripUpdate.StopTimeUpdate.$Shape
             */

            /**
             * Constructs a new StopTimeUpdate.
             * @memberof transit_realtime.TripUpdate
             * @classdesc Represents a StopTimeUpdate.
             * @constructor
             * @param {transit_realtime.TripUpdate.StopTimeUpdate.$Properties=} [properties] Properties to set
             * @property {transit_realtime.NyctStopTimeUpdate.$Properties|null} [".transit_realtime.nyctStopTimeUpdate"] StopTimeUpdate .transit_realtime.nyctStopTimeUpdate
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */
            const StopTimeUpdate = function (properties) {
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            /**
             * StopTimeUpdate stopSequence.
             * @member {number} stopSequence
             * @memberof transit_realtime.TripUpdate.StopTimeUpdate
             * @instance
             */
            StopTimeUpdate.prototype.stopSequence = 0;

            /**
             * StopTimeUpdate stopId.
             * @member {string} stopId
             * @memberof transit_realtime.TripUpdate.StopTimeUpdate
             * @instance
             */
            StopTimeUpdate.prototype.stopId = "";

            /**
             * StopTimeUpdate arrival.
             * @member {transit_realtime.TripUpdate.StopTimeEvent.$Properties|null|undefined} arrival
             * @memberof transit_realtime.TripUpdate.StopTimeUpdate
             * @instance
             */
            StopTimeUpdate.prototype.arrival = null;

            /**
             * StopTimeUpdate departure.
             * @member {transit_realtime.TripUpdate.StopTimeEvent.$Properties|null|undefined} departure
             * @memberof transit_realtime.TripUpdate.StopTimeUpdate
             * @instance
             */
            StopTimeUpdate.prototype.departure = null;

            /**
             * StopTimeUpdate departureOccupancyStatus.
             * @member {transit_realtime.VehiclePosition.OccupancyStatus} departureOccupancyStatus
             * @memberof transit_realtime.TripUpdate.StopTimeUpdate
             * @instance
             */
            StopTimeUpdate.prototype.departureOccupancyStatus = 0;

            /**
             * StopTimeUpdate scheduleRelationship.
             * @member {transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship} scheduleRelationship
             * @memberof transit_realtime.TripUpdate.StopTimeUpdate
             * @instance
             */
            StopTimeUpdate.prototype.scheduleRelationship = 0;

            /**
             * StopTimeUpdate stopTimeProperties.
             * @member {transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties|null|undefined} stopTimeProperties
             * @memberof transit_realtime.TripUpdate.StopTimeUpdate
             * @instance
             */
            StopTimeUpdate.prototype.stopTimeProperties = null;

            StopTimeUpdate.prototype[".transit_realtime.nyctStopTimeUpdate"] = null;

            /**
             * Encodes the specified StopTimeUpdate message. Does not implicitly {@link transit_realtime.TripUpdate.StopTimeUpdate.verify|verify} messages.
             * @function encode
             * @memberof transit_realtime.TripUpdate.StopTimeUpdate
             * @static
             * @param {transit_realtime.TripUpdate.StopTimeUpdate.$Properties} message StopTimeUpdate message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            StopTimeUpdate.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (message.stopSequence != null && $Object.hasOwnProperty.call(message, "stopSequence"))
                    writer.uint32(/* id 1, wireType 0 =*/8).uint32(message.stopSequence);
                if (message.arrival != null && $Object.hasOwnProperty.call(message, "arrival"))
                    $root.transit_realtime.TripUpdate.StopTimeEvent.encode(message.arrival, writer.uint32(/* id 2, wireType 2 =*/18).fork(), _depth + 1).ldelim();
                if (message.departure != null && $Object.hasOwnProperty.call(message, "departure"))
                    $root.transit_realtime.TripUpdate.StopTimeEvent.encode(message.departure, writer.uint32(/* id 3, wireType 2 =*/26).fork(), _depth + 1).ldelim();
                if (message.stopId != null && $Object.hasOwnProperty.call(message, "stopId"))
                    writer.uint32(/* id 4, wireType 2 =*/34).string(message.stopId);
                if (message.scheduleRelationship != null && $Object.hasOwnProperty.call(message, "scheduleRelationship"))
                    writer.uint32(/* id 5, wireType 0 =*/40).int32(message.scheduleRelationship);
                if (message.stopTimeProperties != null && $Object.hasOwnProperty.call(message, "stopTimeProperties"))
                    $root.transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.encode(message.stopTimeProperties, writer.uint32(/* id 6, wireType 2 =*/50).fork(), _depth + 1).ldelim();
                if (message.departureOccupancyStatus != null && $Object.hasOwnProperty.call(message, "departureOccupancyStatus"))
                    writer.uint32(/* id 7, wireType 0 =*/56).int32(message.departureOccupancyStatus);
                if (message[".transit_realtime.nyctStopTimeUpdate"] != null && $Object.hasOwnProperty.call(message, ".transit_realtime.nyctStopTimeUpdate"))
                    $root.transit_realtime.NyctStopTimeUpdate.encode(message[".transit_realtime.nyctStopTimeUpdate"], writer.uint32(/* id 1001, wireType 2 =*/8010).fork(), _depth + 1).ldelim();
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            /**
             * Decodes a StopTimeUpdate message from the specified reader or buffer.
             * @function decode
             * @memberof transit_realtime.TripUpdate.StopTimeUpdate
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {transit_realtime.TripUpdate.StopTimeUpdate & transit_realtime.TripUpdate.StopTimeUpdate.$Shape} StopTimeUpdate
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            StopTimeUpdate.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TripUpdate.StopTimeUpdate(), value;
                while (reader.pos < end) {
                    let start = reader.pos;
                    let tag = reader.tag();
                    if (tag === _end) {
                        _end = $undefined;
                        break;
                    }
                    let wireType = tag & 7;
                    switch (tag >>>= 3) {
                    case 1: {
                            if (wireType !== 0)
                                break;
                            message.stopSequence = reader.uint32();
                            continue;
                        }
                    case 4: {
                            if (wireType !== 2)
                                break;
                            message.stopId = reader.string();
                            continue;
                        }
                    case 2: {
                            if (wireType !== 2)
                                break;
                            message.arrival = $root.transit_realtime.TripUpdate.StopTimeEvent.decode(reader, reader.uint32(), $undefined, _depth + 1, message.arrival);
                            continue;
                        }
                    case 3: {
                            if (wireType !== 2)
                                break;
                            message.departure = $root.transit_realtime.TripUpdate.StopTimeEvent.decode(reader, reader.uint32(), $undefined, _depth + 1, message.departure);
                            continue;
                        }
                    case 7: {
                            if (wireType !== 0)
                                break;
                            value = reader.int32();
                            if ($root.transit_realtime.VehiclePosition.OccupancyStatus[value] !== $undefined)
                                message.departureOccupancyStatus = value;
                            else if (!reader.discardUnknown) {
                                $util.makeProp(message, "$unknowns", false);
                                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                            }
                            continue;
                        }
                    case 5: {
                            if (wireType !== 0)
                                break;
                            value = reader.int32();
                            if ($root.transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship[value] !== $undefined)
                                message.scheduleRelationship = value;
                            else if (!reader.discardUnknown) {
                                $util.makeProp(message, "$unknowns", false);
                                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                            }
                            continue;
                        }
                    case 6: {
                            if (wireType !== 2)
                                break;
                            message.stopTimeProperties = $root.transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.decode(reader, reader.uint32(), $undefined, _depth + 1, message.stopTimeProperties);
                            continue;
                        }
                    case 1001: {
                            if (wireType !== 2)
                                break;
                            message[".transit_realtime.nyctStopTimeUpdate"] = $root.transit_realtime.NyctStopTimeUpdate.decode(reader, reader.uint32(), $undefined, _depth + 1, message[".transit_realtime.nyctStopTimeUpdate"]);
                            continue;
                        }
                    }
                    reader.skipType(wireType, _depth, tag);
                    if (!reader.discardUnknown) {
                        $util.makeProp(message, "$unknowns", false);
                        (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                    }
                }
                if (_end !== $undefined)
                    throw $Error("missing end group");
                return message;
            };

            /**
             * Gets the type url for StopTimeUpdate
             * @function getTypeUrl
             * @memberof transit_realtime.TripUpdate.StopTimeUpdate
             * @static
             * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns {string} The type url
             */
            StopTimeUpdate.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/transit_realtime.TripUpdate.StopTimeUpdate";
            };

            /**
             * ScheduleRelationship enum.
             * @name transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship
             * @enum {number}
             * @property {number} SCHEDULED=0 SCHEDULED value
             * @property {number} SKIPPED=1 SKIPPED value
             * @property {number} NO_DATA=2 NO_DATA value
             * @property {number} UNSCHEDULED=3 UNSCHEDULED value
             */
            StopTimeUpdate.ScheduleRelationship = (function() {
                const valuesById = $Object.create(null), values = $Object.create(valuesById);
                values[valuesById[0] = "SCHEDULED"] = 0;
                values[valuesById[1] = "SKIPPED"] = 1;
                values[valuesById[2] = "NO_DATA"] = 2;
                values[valuesById[3] = "UNSCHEDULED"] = 3;
                return values;
            })();

            StopTimeUpdate.StopTimeProperties = (function() {

                /**
                 * Properties of a StopTimeProperties.
                 * @typedef {Object} transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties
                 * @property {string|null} [assignedStopId] StopTimeProperties assignedStopId
                 * @property {string|null} [stopHeadsign] StopTimeProperties stopHeadsign
                 * @property {transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.DropOffPickupType|null} [pickupType] StopTimeProperties pickupType
                 * @property {transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.DropOffPickupType|null} [dropOffType] StopTimeProperties dropOffType
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */

                /**
                 * Properties of a StopTimeProperties.
                 * @memberof transit_realtime.TripUpdate.StopTimeUpdate
                 * @interface IStopTimeProperties
                 * @augments transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties
                 * @deprecated Use transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties instead.
                 */

                /**
                 * Shape of a StopTimeProperties.
                 * @typedef {transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties} transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Shape
                 */

                /**
                 * Constructs a new StopTimeProperties.
                 * @memberof transit_realtime.TripUpdate.StopTimeUpdate
                 * @classdesc Represents a StopTimeProperties.
                 * @constructor
                 * @param {transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties=} [properties] Properties to set
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */
                const StopTimeProperties = function (properties) {
                    if (properties)
                        for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null && keys[i] !== "__proto__")
                                this[keys[i]] = properties[keys[i]];
                };

                /**
                 * StopTimeProperties assignedStopId.
                 * @member {string} assignedStopId
                 * @memberof transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties
                 * @instance
                 */
                StopTimeProperties.prototype.assignedStopId = "";

                /**
                 * StopTimeProperties stopHeadsign.
                 * @member {string} stopHeadsign
                 * @memberof transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties
                 * @instance
                 */
                StopTimeProperties.prototype.stopHeadsign = "";

                /**
                 * StopTimeProperties pickupType.
                 * @member {transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.DropOffPickupType} pickupType
                 * @memberof transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties
                 * @instance
                 */
                StopTimeProperties.prototype.pickupType = 0;

                /**
                 * StopTimeProperties dropOffType.
                 * @member {transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.DropOffPickupType} dropOffType
                 * @memberof transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties
                 * @instance
                 */
                StopTimeProperties.prototype.dropOffType = 0;

                /**
                 * Encodes the specified StopTimeProperties message. Does not implicitly {@link transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.verify|verify} messages.
                 * @function encode
                 * @memberof transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties
                 * @static
                 * @param {transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Properties} message StopTimeProperties message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                StopTimeProperties.encode = function (message, writer, _depth) {
                    if (!writer)
                        writer = $Writer.create();
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        throw $Error("max depth exceeded");
                    if (message.assignedStopId != null && $Object.hasOwnProperty.call(message, "assignedStopId"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.assignedStopId);
                    if (message.stopHeadsign != null && $Object.hasOwnProperty.call(message, "stopHeadsign"))
                        writer.uint32(/* id 2, wireType 2 =*/18).string(message.stopHeadsign);
                    if (message.pickupType != null && $Object.hasOwnProperty.call(message, "pickupType"))
                        writer.uint32(/* id 3, wireType 0 =*/24).int32(message.pickupType);
                    if (message.dropOffType != null && $Object.hasOwnProperty.call(message, "dropOffType"))
                        writer.uint32(/* id 4, wireType 0 =*/32).int32(message.dropOffType);
                    if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                        for (let i = 0; i < message.$unknowns.length; ++i)
                            writer.raw(message.$unknowns[i]);
                    return writer;
                };

                /**
                 * Decodes a StopTimeProperties message from the specified reader or buffer.
                 * @function decode
                 * @memberof transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties & transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.$Shape} StopTimeProperties
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                StopTimeProperties.decode = function (reader, length, _end, _depth, _target) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $Reader.recursionLimit)
                        throw $Error("max depth exceeded");
                    let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties(), value;
                    while (reader.pos < end) {
                        let start = reader.pos;
                        let tag = reader.tag();
                        if (tag === _end) {
                            _end = $undefined;
                            break;
                        }
                        let wireType = tag & 7;
                        switch (tag >>>= 3) {
                        case 1: {
                                if (wireType !== 2)
                                    break;
                                message.assignedStopId = reader.string();
                                continue;
                            }
                        case 2: {
                                if (wireType !== 2)
                                    break;
                                message.stopHeadsign = reader.string();
                                continue;
                            }
                        case 3: {
                                if (wireType !== 0)
                                    break;
                                value = reader.int32();
                                if ($root.transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.DropOffPickupType[value] !== $undefined)
                                    message.pickupType = value;
                                else if (!reader.discardUnknown) {
                                    $util.makeProp(message, "$unknowns", false);
                                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                                }
                                continue;
                            }
                        case 4: {
                                if (wireType !== 0)
                                    break;
                                value = reader.int32();
                                if ($root.transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.DropOffPickupType[value] !== $undefined)
                                    message.dropOffType = value;
                                else if (!reader.discardUnknown) {
                                    $util.makeProp(message, "$unknowns", false);
                                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                                }
                                continue;
                            }
                        }
                        reader.skipType(wireType, _depth, tag);
                        if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                    }
                    if (_end !== $undefined)
                        throw $Error("missing end group");
                    return message;
                };

                /**
                 * Gets the type url for StopTimeProperties
                 * @function getTypeUrl
                 * @memberof transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties
                 * @static
                 * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns {string} The type url
                 */
                StopTimeProperties.getTypeUrl = function(prefix) {
                    if (prefix === $undefined)
                        prefix = "type.googleapis.com";
                    return prefix + "/transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties";
                };

                /**
                 * DropOffPickupType enum.
                 * @name transit_realtime.TripUpdate.StopTimeUpdate.StopTimeProperties.DropOffPickupType
                 * @enum {number}
                 * @property {number} REGULAR=0 REGULAR value
                 * @property {number} NONE=1 NONE value
                 * @property {number} PHONE_AGENCY=2 PHONE_AGENCY value
                 * @property {number} COORDINATE_WITH_DRIVER=3 COORDINATE_WITH_DRIVER value
                 */
                StopTimeProperties.DropOffPickupType = (function() {
                    const valuesById = $Object.create(null), values = $Object.create(valuesById);
                    values[valuesById[0] = "REGULAR"] = 0;
                    values[valuesById[1] = "NONE"] = 1;
                    values[valuesById[2] = "PHONE_AGENCY"] = 2;
                    values[valuesById[3] = "COORDINATE_WITH_DRIVER"] = 3;
                    return values;
                })();

                return StopTimeProperties;
            })();

            return StopTimeUpdate;
        })();

        TripUpdate.TripProperties = (function() {

            /**
             * Properties of a TripProperties.
             * @typedef {Object} transit_realtime.TripUpdate.TripProperties.$Properties
             * @property {string|null} [tripId] TripProperties tripId
             * @property {string|null} [startDate] TripProperties startDate
             * @property {string|null} [startTime] TripProperties startTime
             * @property {string|null} [shapeId] TripProperties shapeId
             * @property {string|null} [tripHeadsign] TripProperties tripHeadsign
             * @property {string|null} [tripShortName] TripProperties tripShortName
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */

            /**
             * Properties of a TripProperties.
             * @memberof transit_realtime.TripUpdate
             * @interface ITripProperties
             * @augments transit_realtime.TripUpdate.TripProperties.$Properties
             * @deprecated Use transit_realtime.TripUpdate.TripProperties.$Properties instead.
             */

            /**
             * Shape of a TripProperties.
             * @typedef {transit_realtime.TripUpdate.TripProperties.$Properties} transit_realtime.TripUpdate.TripProperties.$Shape
             */

            /**
             * Constructs a new TripProperties.
             * @memberof transit_realtime.TripUpdate
             * @classdesc Represents a TripProperties.
             * @constructor
             * @param {transit_realtime.TripUpdate.TripProperties.$Properties=} [properties] Properties to set
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */
            const TripProperties = function (properties) {
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            /**
             * TripProperties tripId.
             * @member {string} tripId
             * @memberof transit_realtime.TripUpdate.TripProperties
             * @instance
             */
            TripProperties.prototype.tripId = "";

            /**
             * TripProperties startDate.
             * @member {string} startDate
             * @memberof transit_realtime.TripUpdate.TripProperties
             * @instance
             */
            TripProperties.prototype.startDate = "";

            /**
             * TripProperties startTime.
             * @member {string} startTime
             * @memberof transit_realtime.TripUpdate.TripProperties
             * @instance
             */
            TripProperties.prototype.startTime = "";

            /**
             * TripProperties shapeId.
             * @member {string} shapeId
             * @memberof transit_realtime.TripUpdate.TripProperties
             * @instance
             */
            TripProperties.prototype.shapeId = "";

            /**
             * TripProperties tripHeadsign.
             * @member {string} tripHeadsign
             * @memberof transit_realtime.TripUpdate.TripProperties
             * @instance
             */
            TripProperties.prototype.tripHeadsign = "";

            /**
             * TripProperties tripShortName.
             * @member {string} tripShortName
             * @memberof transit_realtime.TripUpdate.TripProperties
             * @instance
             */
            TripProperties.prototype.tripShortName = "";

            /**
             * Encodes the specified TripProperties message. Does not implicitly {@link transit_realtime.TripUpdate.TripProperties.verify|verify} messages.
             * @function encode
             * @memberof transit_realtime.TripUpdate.TripProperties
             * @static
             * @param {transit_realtime.TripUpdate.TripProperties.$Properties} message TripProperties message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            TripProperties.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (message.tripId != null && $Object.hasOwnProperty.call(message, "tripId"))
                    writer.uint32(/* id 1, wireType 2 =*/10).string(message.tripId);
                if (message.startDate != null && $Object.hasOwnProperty.call(message, "startDate"))
                    writer.uint32(/* id 2, wireType 2 =*/18).string(message.startDate);
                if (message.startTime != null && $Object.hasOwnProperty.call(message, "startTime"))
                    writer.uint32(/* id 3, wireType 2 =*/26).string(message.startTime);
                if (message.shapeId != null && $Object.hasOwnProperty.call(message, "shapeId"))
                    writer.uint32(/* id 4, wireType 2 =*/34).string(message.shapeId);
                if (message.tripHeadsign != null && $Object.hasOwnProperty.call(message, "tripHeadsign"))
                    writer.uint32(/* id 5, wireType 2 =*/42).string(message.tripHeadsign);
                if (message.tripShortName != null && $Object.hasOwnProperty.call(message, "tripShortName"))
                    writer.uint32(/* id 6, wireType 2 =*/50).string(message.tripShortName);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            /**
             * Decodes a TripProperties message from the specified reader or buffer.
             * @function decode
             * @memberof transit_realtime.TripUpdate.TripProperties
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {transit_realtime.TripUpdate.TripProperties & transit_realtime.TripUpdate.TripProperties.$Shape} TripProperties
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            TripProperties.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TripUpdate.TripProperties();
                while (reader.pos < end) {
                    let start = reader.pos;
                    let tag = reader.tag();
                    if (tag === _end) {
                        _end = $undefined;
                        break;
                    }
                    let wireType = tag & 7;
                    switch (tag >>>= 3) {
                    case 1: {
                            if (wireType !== 2)
                                break;
                            message.tripId = reader.string();
                            continue;
                        }
                    case 2: {
                            if (wireType !== 2)
                                break;
                            message.startDate = reader.string();
                            continue;
                        }
                    case 3: {
                            if (wireType !== 2)
                                break;
                            message.startTime = reader.string();
                            continue;
                        }
                    case 4: {
                            if (wireType !== 2)
                                break;
                            message.shapeId = reader.string();
                            continue;
                        }
                    case 5: {
                            if (wireType !== 2)
                                break;
                            message.tripHeadsign = reader.string();
                            continue;
                        }
                    case 6: {
                            if (wireType !== 2)
                                break;
                            message.tripShortName = reader.string();
                            continue;
                        }
                    }
                    reader.skipType(wireType, _depth, tag);
                    if (!reader.discardUnknown) {
                        $util.makeProp(message, "$unknowns", false);
                        (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                    }
                }
                if (_end !== $undefined)
                    throw $Error("missing end group");
                return message;
            };

            /**
             * Gets the type url for TripProperties
             * @function getTypeUrl
             * @memberof transit_realtime.TripUpdate.TripProperties
             * @static
             * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns {string} The type url
             */
            TripProperties.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/transit_realtime.TripUpdate.TripProperties";
            };

            return TripProperties;
        })();

        return TripUpdate;
    })();

    transit_realtime.VehiclePosition = (function() {

        /**
         * Properties of a VehiclePosition.
         * @typedef {Object} transit_realtime.VehiclePosition.$Properties
         * @property {transit_realtime.TripDescriptor.$Properties|null} [trip] VehiclePosition trip
         * @property {transit_realtime.VehicleDescriptor.$Properties|null} [vehicle] VehiclePosition vehicle
         * @property {transit_realtime.Position.$Properties|null} [position] VehiclePosition position
         * @property {number|null} [currentStopSequence] VehiclePosition currentStopSequence
         * @property {string|null} [stopId] VehiclePosition stopId
         * @property {transit_realtime.VehiclePosition.VehicleStopStatus|null} [currentStatus] VehiclePosition currentStatus
         * @property {number|Long|null} [timestamp] VehiclePosition timestamp
         * @property {transit_realtime.VehiclePosition.CongestionLevel|null} [congestionLevel] VehiclePosition congestionLevel
         * @property {transit_realtime.VehiclePosition.OccupancyStatus|null} [occupancyStatus] VehiclePosition occupancyStatus
         * @property {number|null} [occupancyPercentage] VehiclePosition occupancyPercentage
         * @property {Array.<transit_realtime.VehiclePosition.CarriageDetails.$Properties>|null} [multiCarriageDetails] VehiclePosition multiCarriageDetails
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a VehiclePosition.
         * @memberof transit_realtime
         * @interface IVehiclePosition
         * @augments transit_realtime.VehiclePosition.$Properties
         * @deprecated Use transit_realtime.VehiclePosition.$Properties instead.
         */

        /**
         * Shape of a VehiclePosition.
         * @typedef {transit_realtime.VehiclePosition.$Properties} transit_realtime.VehiclePosition.$Shape
         */

        /**
         * Constructs a new VehiclePosition.
         * @memberof transit_realtime
         * @classdesc Represents a VehiclePosition.
         * @constructor
         * @param {transit_realtime.VehiclePosition.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const VehiclePosition = function (properties) {
            this.multiCarriageDetails = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * VehiclePosition trip.
         * @member {transit_realtime.TripDescriptor.$Properties|null|undefined} trip
         * @memberof transit_realtime.VehiclePosition
         * @instance
         */
        VehiclePosition.prototype.trip = null;

        /**
         * VehiclePosition vehicle.
         * @member {transit_realtime.VehicleDescriptor.$Properties|null|undefined} vehicle
         * @memberof transit_realtime.VehiclePosition
         * @instance
         */
        VehiclePosition.prototype.vehicle = null;

        /**
         * VehiclePosition position.
         * @member {transit_realtime.Position.$Properties|null|undefined} position
         * @memberof transit_realtime.VehiclePosition
         * @instance
         */
        VehiclePosition.prototype.position = null;

        /**
         * VehiclePosition currentStopSequence.
         * @member {number} currentStopSequence
         * @memberof transit_realtime.VehiclePosition
         * @instance
         */
        VehiclePosition.prototype.currentStopSequence = 0;

        /**
         * VehiclePosition stopId.
         * @member {string} stopId
         * @memberof transit_realtime.VehiclePosition
         * @instance
         */
        VehiclePosition.prototype.stopId = "";

        /**
         * VehiclePosition currentStatus.
         * @member {transit_realtime.VehiclePosition.VehicleStopStatus} currentStatus
         * @memberof transit_realtime.VehiclePosition
         * @instance
         */
        VehiclePosition.prototype.currentStatus = 2;

        /**
         * VehiclePosition timestamp.
         * @member {number|Long} timestamp
         * @memberof transit_realtime.VehiclePosition
         * @instance
         */
        VehiclePosition.prototype.timestamp = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * VehiclePosition congestionLevel.
         * @member {transit_realtime.VehiclePosition.CongestionLevel} congestionLevel
         * @memberof transit_realtime.VehiclePosition
         * @instance
         */
        VehiclePosition.prototype.congestionLevel = 0;

        /**
         * VehiclePosition occupancyStatus.
         * @member {transit_realtime.VehiclePosition.OccupancyStatus} occupancyStatus
         * @memberof transit_realtime.VehiclePosition
         * @instance
         */
        VehiclePosition.prototype.occupancyStatus = 0;

        /**
         * VehiclePosition occupancyPercentage.
         * @member {number} occupancyPercentage
         * @memberof transit_realtime.VehiclePosition
         * @instance
         */
        VehiclePosition.prototype.occupancyPercentage = 0;

        /**
         * VehiclePosition multiCarriageDetails.
         * @member {Array.<transit_realtime.VehiclePosition.CarriageDetails.$Properties>} multiCarriageDetails
         * @memberof transit_realtime.VehiclePosition
         * @instance
         */
        VehiclePosition.prototype.multiCarriageDetails = $util.emptyArray;

        /**
         * Encodes the specified VehiclePosition message. Does not implicitly {@link transit_realtime.VehiclePosition.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.VehiclePosition
         * @static
         * @param {transit_realtime.VehiclePosition.$Properties} message VehiclePosition message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        VehiclePosition.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.trip != null && $Object.hasOwnProperty.call(message, "trip"))
                $root.transit_realtime.TripDescriptor.encode(message.trip, writer.uint32(/* id 1, wireType 2 =*/10).fork(), _depth + 1).ldelim();
            if (message.position != null && $Object.hasOwnProperty.call(message, "position"))
                $root.transit_realtime.Position.encode(message.position, writer.uint32(/* id 2, wireType 2 =*/18).fork(), _depth + 1).ldelim();
            if (message.currentStopSequence != null && $Object.hasOwnProperty.call(message, "currentStopSequence"))
                writer.uint32(/* id 3, wireType 0 =*/24).uint32(message.currentStopSequence);
            if (message.currentStatus != null && $Object.hasOwnProperty.call(message, "currentStatus"))
                writer.uint32(/* id 4, wireType 0 =*/32).int32(message.currentStatus);
            if (message.timestamp != null && $Object.hasOwnProperty.call(message, "timestamp"))
                writer.uint32(/* id 5, wireType 0 =*/40).uint64(message.timestamp);
            if (message.congestionLevel != null && $Object.hasOwnProperty.call(message, "congestionLevel"))
                writer.uint32(/* id 6, wireType 0 =*/48).int32(message.congestionLevel);
            if (message.stopId != null && $Object.hasOwnProperty.call(message, "stopId"))
                writer.uint32(/* id 7, wireType 2 =*/58).string(message.stopId);
            if (message.vehicle != null && $Object.hasOwnProperty.call(message, "vehicle"))
                $root.transit_realtime.VehicleDescriptor.encode(message.vehicle, writer.uint32(/* id 8, wireType 2 =*/66).fork(), _depth + 1).ldelim();
            if (message.occupancyStatus != null && $Object.hasOwnProperty.call(message, "occupancyStatus"))
                writer.uint32(/* id 9, wireType 0 =*/72).int32(message.occupancyStatus);
            if (message.occupancyPercentage != null && $Object.hasOwnProperty.call(message, "occupancyPercentage"))
                writer.uint32(/* id 10, wireType 0 =*/80).uint32(message.occupancyPercentage);
            if (message.multiCarriageDetails != null && message.multiCarriageDetails.length)
                for (let i = 0; i < message.multiCarriageDetails.length; ++i)
                    $root.transit_realtime.VehiclePosition.CarriageDetails.encode(message.multiCarriageDetails[i], writer.uint32(/* id 11, wireType 2 =*/90).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a VehiclePosition message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.VehiclePosition
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.VehiclePosition & transit_realtime.VehiclePosition.$Shape} VehiclePosition
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        VehiclePosition.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.VehiclePosition(), value;
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        message.trip = $root.transit_realtime.TripDescriptor.decode(reader, reader.uint32(), $undefined, _depth + 1, message.trip);
                        continue;
                    }
                case 8: {
                        if (wireType !== 2)
                            break;
                        message.vehicle = $root.transit_realtime.VehicleDescriptor.decode(reader, reader.uint32(), $undefined, _depth + 1, message.vehicle);
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.position = $root.transit_realtime.Position.decode(reader, reader.uint32(), $undefined, _depth + 1, message.position);
                        continue;
                    }
                case 3: {
                        if (wireType !== 0)
                            break;
                        message.currentStopSequence = reader.uint32();
                        continue;
                    }
                case 7: {
                        if (wireType !== 2)
                            break;
                        message.stopId = reader.string();
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        value = reader.int32();
                        if ($root.transit_realtime.VehiclePosition.VehicleStopStatus[value] !== $undefined)
                            message.currentStatus = value;
                        else if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                        continue;
                    }
                case 5: {
                        if (wireType !== 0)
                            break;
                        message.timestamp = reader.uint64();
                        continue;
                    }
                case 6: {
                        if (wireType !== 0)
                            break;
                        value = reader.int32();
                        if ($root.transit_realtime.VehiclePosition.CongestionLevel[value] !== $undefined)
                            message.congestionLevel = value;
                        else if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                        continue;
                    }
                case 9: {
                        if (wireType !== 0)
                            break;
                        value = reader.int32();
                        if ($root.transit_realtime.VehiclePosition.OccupancyStatus[value] !== $undefined)
                            message.occupancyStatus = value;
                        else if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                        continue;
                    }
                case 10: {
                        if (wireType !== 0)
                            break;
                        message.occupancyPercentage = reader.uint32();
                        continue;
                    }
                case 11: {
                        if (wireType !== 2)
                            break;
                        if (!(message.multiCarriageDetails && message.multiCarriageDetails.length))
                            message.multiCarriageDetails = [];
                        message.multiCarriageDetails.push($root.transit_realtime.VehiclePosition.CarriageDetails.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for VehiclePosition
         * @function getTypeUrl
         * @memberof transit_realtime.VehiclePosition
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        VehiclePosition.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.VehiclePosition";
        };

        /**
         * VehicleStopStatus enum.
         * @name transit_realtime.VehiclePosition.VehicleStopStatus
         * @enum {number}
         * @property {number} INCOMING_AT=0 INCOMING_AT value
         * @property {number} STOPPED_AT=1 STOPPED_AT value
         * @property {number} IN_TRANSIT_TO=2 IN_TRANSIT_TO value
         */
        VehiclePosition.VehicleStopStatus = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[0] = "INCOMING_AT"] = 0;
            values[valuesById[1] = "STOPPED_AT"] = 1;
            values[valuesById[2] = "IN_TRANSIT_TO"] = 2;
            return values;
        })();

        /**
         * CongestionLevel enum.
         * @name transit_realtime.VehiclePosition.CongestionLevel
         * @enum {number}
         * @property {number} UNKNOWN_CONGESTION_LEVEL=0 UNKNOWN_CONGESTION_LEVEL value
         * @property {number} RUNNING_SMOOTHLY=1 RUNNING_SMOOTHLY value
         * @property {number} STOP_AND_GO=2 STOP_AND_GO value
         * @property {number} CONGESTION=3 CONGESTION value
         * @property {number} SEVERE_CONGESTION=4 SEVERE_CONGESTION value
         */
        VehiclePosition.CongestionLevel = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[0] = "UNKNOWN_CONGESTION_LEVEL"] = 0;
            values[valuesById[1] = "RUNNING_SMOOTHLY"] = 1;
            values[valuesById[2] = "STOP_AND_GO"] = 2;
            values[valuesById[3] = "CONGESTION"] = 3;
            values[valuesById[4] = "SEVERE_CONGESTION"] = 4;
            return values;
        })();

        /**
         * OccupancyStatus enum.
         * @name transit_realtime.VehiclePosition.OccupancyStatus
         * @enum {number}
         * @property {number} EMPTY=0 EMPTY value
         * @property {number} MANY_SEATS_AVAILABLE=1 MANY_SEATS_AVAILABLE value
         * @property {number} FEW_SEATS_AVAILABLE=2 FEW_SEATS_AVAILABLE value
         * @property {number} STANDING_ROOM_ONLY=3 STANDING_ROOM_ONLY value
         * @property {number} CRUSHED_STANDING_ROOM_ONLY=4 CRUSHED_STANDING_ROOM_ONLY value
         * @property {number} FULL=5 FULL value
         * @property {number} NOT_ACCEPTING_PASSENGERS=6 NOT_ACCEPTING_PASSENGERS value
         * @property {number} NO_DATA_AVAILABLE=7 NO_DATA_AVAILABLE value
         * @property {number} NOT_BOARDABLE=8 NOT_BOARDABLE value
         */
        VehiclePosition.OccupancyStatus = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[0] = "EMPTY"] = 0;
            values[valuesById[1] = "MANY_SEATS_AVAILABLE"] = 1;
            values[valuesById[2] = "FEW_SEATS_AVAILABLE"] = 2;
            values[valuesById[3] = "STANDING_ROOM_ONLY"] = 3;
            values[valuesById[4] = "CRUSHED_STANDING_ROOM_ONLY"] = 4;
            values[valuesById[5] = "FULL"] = 5;
            values[valuesById[6] = "NOT_ACCEPTING_PASSENGERS"] = 6;
            values[valuesById[7] = "NO_DATA_AVAILABLE"] = 7;
            values[valuesById[8] = "NOT_BOARDABLE"] = 8;
            return values;
        })();

        VehiclePosition.CarriageDetails = (function() {

            /**
             * Properties of a CarriageDetails.
             * @typedef {Object} transit_realtime.VehiclePosition.CarriageDetails.$Properties
             * @property {string|null} [id] CarriageDetails id
             * @property {string|null} [label] CarriageDetails label
             * @property {transit_realtime.VehiclePosition.OccupancyStatus|null} [occupancyStatus] CarriageDetails occupancyStatus
             * @property {number|null} [occupancyPercentage] CarriageDetails occupancyPercentage
             * @property {number|null} [carriageSequence] CarriageDetails carriageSequence
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */

            /**
             * Properties of a CarriageDetails.
             * @memberof transit_realtime.VehiclePosition
             * @interface ICarriageDetails
             * @augments transit_realtime.VehiclePosition.CarriageDetails.$Properties
             * @deprecated Use transit_realtime.VehiclePosition.CarriageDetails.$Properties instead.
             */

            /**
             * Shape of a CarriageDetails.
             * @typedef {transit_realtime.VehiclePosition.CarriageDetails.$Properties} transit_realtime.VehiclePosition.CarriageDetails.$Shape
             */

            /**
             * Constructs a new CarriageDetails.
             * @memberof transit_realtime.VehiclePosition
             * @classdesc Represents a CarriageDetails.
             * @constructor
             * @param {transit_realtime.VehiclePosition.CarriageDetails.$Properties=} [properties] Properties to set
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */
            const CarriageDetails = function (properties) {
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            /**
             * CarriageDetails id.
             * @member {string} id
             * @memberof transit_realtime.VehiclePosition.CarriageDetails
             * @instance
             */
            CarriageDetails.prototype.id = "";

            /**
             * CarriageDetails label.
             * @member {string} label
             * @memberof transit_realtime.VehiclePosition.CarriageDetails
             * @instance
             */
            CarriageDetails.prototype.label = "";

            /**
             * CarriageDetails occupancyStatus.
             * @member {transit_realtime.VehiclePosition.OccupancyStatus} occupancyStatus
             * @memberof transit_realtime.VehiclePosition.CarriageDetails
             * @instance
             */
            CarriageDetails.prototype.occupancyStatus = 7;

            /**
             * CarriageDetails occupancyPercentage.
             * @member {number} occupancyPercentage
             * @memberof transit_realtime.VehiclePosition.CarriageDetails
             * @instance
             */
            CarriageDetails.prototype.occupancyPercentage = -1;

            /**
             * CarriageDetails carriageSequence.
             * @member {number} carriageSequence
             * @memberof transit_realtime.VehiclePosition.CarriageDetails
             * @instance
             */
            CarriageDetails.prototype.carriageSequence = 0;

            /**
             * Encodes the specified CarriageDetails message. Does not implicitly {@link transit_realtime.VehiclePosition.CarriageDetails.verify|verify} messages.
             * @function encode
             * @memberof transit_realtime.VehiclePosition.CarriageDetails
             * @static
             * @param {transit_realtime.VehiclePosition.CarriageDetails.$Properties} message CarriageDetails message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            CarriageDetails.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (message.id != null && $Object.hasOwnProperty.call(message, "id"))
                    writer.uint32(/* id 1, wireType 2 =*/10).string(message.id);
                if (message.label != null && $Object.hasOwnProperty.call(message, "label"))
                    writer.uint32(/* id 2, wireType 2 =*/18).string(message.label);
                if (message.occupancyStatus != null && $Object.hasOwnProperty.call(message, "occupancyStatus"))
                    writer.uint32(/* id 3, wireType 0 =*/24).int32(message.occupancyStatus);
                if (message.occupancyPercentage != null && $Object.hasOwnProperty.call(message, "occupancyPercentage"))
                    writer.uint32(/* id 4, wireType 0 =*/32).int32(message.occupancyPercentage);
                if (message.carriageSequence != null && $Object.hasOwnProperty.call(message, "carriageSequence"))
                    writer.uint32(/* id 5, wireType 0 =*/40).uint32(message.carriageSequence);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            /**
             * Decodes a CarriageDetails message from the specified reader or buffer.
             * @function decode
             * @memberof transit_realtime.VehiclePosition.CarriageDetails
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {transit_realtime.VehiclePosition.CarriageDetails & transit_realtime.VehiclePosition.CarriageDetails.$Shape} CarriageDetails
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            CarriageDetails.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.VehiclePosition.CarriageDetails(), value;
                while (reader.pos < end) {
                    let start = reader.pos;
                    let tag = reader.tag();
                    if (tag === _end) {
                        _end = $undefined;
                        break;
                    }
                    let wireType = tag & 7;
                    switch (tag >>>= 3) {
                    case 1: {
                            if (wireType !== 2)
                                break;
                            message.id = reader.string();
                            continue;
                        }
                    case 2: {
                            if (wireType !== 2)
                                break;
                            message.label = reader.string();
                            continue;
                        }
                    case 3: {
                            if (wireType !== 0)
                                break;
                            value = reader.int32();
                            if ($root.transit_realtime.VehiclePosition.OccupancyStatus[value] !== $undefined)
                                message.occupancyStatus = value;
                            else if (!reader.discardUnknown) {
                                $util.makeProp(message, "$unknowns", false);
                                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                            }
                            continue;
                        }
                    case 4: {
                            if (wireType !== 0)
                                break;
                            message.occupancyPercentage = reader.int32();
                            continue;
                        }
                    case 5: {
                            if (wireType !== 0)
                                break;
                            message.carriageSequence = reader.uint32();
                            continue;
                        }
                    }
                    reader.skipType(wireType, _depth, tag);
                    if (!reader.discardUnknown) {
                        $util.makeProp(message, "$unknowns", false);
                        (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                    }
                }
                if (_end !== $undefined)
                    throw $Error("missing end group");
                return message;
            };

            /**
             * Gets the type url for CarriageDetails
             * @function getTypeUrl
             * @memberof transit_realtime.VehiclePosition.CarriageDetails
             * @static
             * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns {string} The type url
             */
            CarriageDetails.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/transit_realtime.VehiclePosition.CarriageDetails";
            };

            return CarriageDetails;
        })();

        return VehiclePosition;
    })();

    transit_realtime.Alert = (function() {

        /**
         * Properties of an Alert.
         * @typedef {Object} transit_realtime.Alert.$Properties
         * @property {Array.<transit_realtime.TimeRange.$Properties>|null} [activePeriod] Alert activePeriod
         * @property {Array.<transit_realtime.TimeRange.$Properties>|null} [communicationPeriod] Alert communicationPeriod
         * @property {Array.<transit_realtime.TimeRange.$Properties>|null} [impactPeriod] Alert impactPeriod
         * @property {Array.<transit_realtime.EntitySelector.$Properties>|null} [informedEntity] Alert informedEntity
         * @property {transit_realtime.Alert.Cause|null} [cause] Alert cause
         * @property {transit_realtime.Alert.Effect|null} [effect] Alert effect
         * @property {transit_realtime.TranslatedString.$Properties|null} [url] Alert url
         * @property {transit_realtime.TranslatedString.$Properties|null} [headerText] Alert headerText
         * @property {transit_realtime.TranslatedString.$Properties|null} [descriptionText] Alert descriptionText
         * @property {transit_realtime.TranslatedString.$Properties|null} [ttsHeaderText] Alert ttsHeaderText
         * @property {transit_realtime.TranslatedString.$Properties|null} [ttsDescriptionText] Alert ttsDescriptionText
         * @property {transit_realtime.Alert.SeverityLevel|null} [severityLevel] Alert severityLevel
         * @property {transit_realtime.TranslatedImage.$Properties|null} [image] Alert image
         * @property {transit_realtime.TranslatedString.$Properties|null} [imageAlternativeText] Alert imageAlternativeText
         * @property {transit_realtime.TranslatedString.$Properties|null} [causeDetail] Alert causeDetail
         * @property {transit_realtime.TranslatedString.$Properties|null} [effectDetail] Alert effectDetail
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of an Alert.
         * @memberof transit_realtime
         * @interface IAlert
         * @augments transit_realtime.Alert.$Properties
         * @deprecated Use transit_realtime.Alert.$Properties instead.
         */

        /**
         * Shape of an Alert.
         * @typedef {transit_realtime.Alert.$Properties} transit_realtime.Alert.$Shape
         */

        /**
         * Constructs a new Alert.
         * @memberof transit_realtime
         * @classdesc Represents an Alert.
         * @constructor
         * @param {transit_realtime.Alert.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const Alert = function (properties) {
            this.activePeriod = [];
            this.communicationPeriod = [];
            this.impactPeriod = [];
            this.informedEntity = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * Alert activePeriod.
         * @member {Array.<transit_realtime.TimeRange.$Properties>} activePeriod
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.activePeriod = $util.emptyArray;

        /**
         * Alert communicationPeriod.
         * @member {Array.<transit_realtime.TimeRange.$Properties>} communicationPeriod
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.communicationPeriod = $util.emptyArray;

        /**
         * Alert impactPeriod.
         * @member {Array.<transit_realtime.TimeRange.$Properties>} impactPeriod
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.impactPeriod = $util.emptyArray;

        /**
         * Alert informedEntity.
         * @member {Array.<transit_realtime.EntitySelector.$Properties>} informedEntity
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.informedEntity = $util.emptyArray;

        /**
         * Alert cause.
         * @member {transit_realtime.Alert.Cause} cause
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.cause = 1;

        /**
         * Alert effect.
         * @member {transit_realtime.Alert.Effect} effect
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.effect = 8;

        /**
         * Alert url.
         * @member {transit_realtime.TranslatedString.$Properties|null|undefined} url
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.url = null;

        /**
         * Alert headerText.
         * @member {transit_realtime.TranslatedString.$Properties|null|undefined} headerText
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.headerText = null;

        /**
         * Alert descriptionText.
         * @member {transit_realtime.TranslatedString.$Properties|null|undefined} descriptionText
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.descriptionText = null;

        /**
         * Alert ttsHeaderText.
         * @member {transit_realtime.TranslatedString.$Properties|null|undefined} ttsHeaderText
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.ttsHeaderText = null;

        /**
         * Alert ttsDescriptionText.
         * @member {transit_realtime.TranslatedString.$Properties|null|undefined} ttsDescriptionText
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.ttsDescriptionText = null;

        /**
         * Alert severityLevel.
         * @member {transit_realtime.Alert.SeverityLevel} severityLevel
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.severityLevel = 1;

        /**
         * Alert image.
         * @member {transit_realtime.TranslatedImage.$Properties|null|undefined} image
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.image = null;

        /**
         * Alert imageAlternativeText.
         * @member {transit_realtime.TranslatedString.$Properties|null|undefined} imageAlternativeText
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.imageAlternativeText = null;

        /**
         * Alert causeDetail.
         * @member {transit_realtime.TranslatedString.$Properties|null|undefined} causeDetail
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.causeDetail = null;

        /**
         * Alert effectDetail.
         * @member {transit_realtime.TranslatedString.$Properties|null|undefined} effectDetail
         * @memberof transit_realtime.Alert
         * @instance
         */
        Alert.prototype.effectDetail = null;

        /**
         * Encodes the specified Alert message. Does not implicitly {@link transit_realtime.Alert.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.Alert
         * @static
         * @param {transit_realtime.Alert.$Properties} message Alert message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Alert.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.activePeriod != null && message.activePeriod.length)
                for (let i = 0; i < message.activePeriod.length; ++i)
                    $root.transit_realtime.TimeRange.encode(message.activePeriod[i], writer.uint32(/* id 1, wireType 2 =*/10).fork(), _depth + 1).ldelim();
            if (message.communicationPeriod != null && message.communicationPeriod.length)
                for (let i = 0; i < message.communicationPeriod.length; ++i)
                    $root.transit_realtime.TimeRange.encode(message.communicationPeriod[i], writer.uint32(/* id 2, wireType 2 =*/18).fork(), _depth + 1).ldelim();
            if (message.impactPeriod != null && message.impactPeriod.length)
                for (let i = 0; i < message.impactPeriod.length; ++i)
                    $root.transit_realtime.TimeRange.encode(message.impactPeriod[i], writer.uint32(/* id 3, wireType 2 =*/26).fork(), _depth + 1).ldelim();
            if (message.informedEntity != null && message.informedEntity.length)
                for (let i = 0; i < message.informedEntity.length; ++i)
                    $root.transit_realtime.EntitySelector.encode(message.informedEntity[i], writer.uint32(/* id 5, wireType 2 =*/42).fork(), _depth + 1).ldelim();
            if (message.cause != null && $Object.hasOwnProperty.call(message, "cause"))
                writer.uint32(/* id 6, wireType 0 =*/48).int32(message.cause);
            if (message.effect != null && $Object.hasOwnProperty.call(message, "effect"))
                writer.uint32(/* id 7, wireType 0 =*/56).int32(message.effect);
            if (message.url != null && $Object.hasOwnProperty.call(message, "url"))
                $root.transit_realtime.TranslatedString.encode(message.url, writer.uint32(/* id 8, wireType 2 =*/66).fork(), _depth + 1).ldelim();
            if (message.headerText != null && $Object.hasOwnProperty.call(message, "headerText"))
                $root.transit_realtime.TranslatedString.encode(message.headerText, writer.uint32(/* id 10, wireType 2 =*/82).fork(), _depth + 1).ldelim();
            if (message.descriptionText != null && $Object.hasOwnProperty.call(message, "descriptionText"))
                $root.transit_realtime.TranslatedString.encode(message.descriptionText, writer.uint32(/* id 11, wireType 2 =*/90).fork(), _depth + 1).ldelim();
            if (message.ttsHeaderText != null && $Object.hasOwnProperty.call(message, "ttsHeaderText"))
                $root.transit_realtime.TranslatedString.encode(message.ttsHeaderText, writer.uint32(/* id 12, wireType 2 =*/98).fork(), _depth + 1).ldelim();
            if (message.ttsDescriptionText != null && $Object.hasOwnProperty.call(message, "ttsDescriptionText"))
                $root.transit_realtime.TranslatedString.encode(message.ttsDescriptionText, writer.uint32(/* id 13, wireType 2 =*/106).fork(), _depth + 1).ldelim();
            if (message.severityLevel != null && $Object.hasOwnProperty.call(message, "severityLevel"))
                writer.uint32(/* id 14, wireType 0 =*/112).int32(message.severityLevel);
            if (message.image != null && $Object.hasOwnProperty.call(message, "image"))
                $root.transit_realtime.TranslatedImage.encode(message.image, writer.uint32(/* id 15, wireType 2 =*/122).fork(), _depth + 1).ldelim();
            if (message.imageAlternativeText != null && $Object.hasOwnProperty.call(message, "imageAlternativeText"))
                $root.transit_realtime.TranslatedString.encode(message.imageAlternativeText, writer.uint32(/* id 16, wireType 2 =*/130).fork(), _depth + 1).ldelim();
            if (message.causeDetail != null && $Object.hasOwnProperty.call(message, "causeDetail"))
                $root.transit_realtime.TranslatedString.encode(message.causeDetail, writer.uint32(/* id 17, wireType 2 =*/138).fork(), _depth + 1).ldelim();
            if (message.effectDetail != null && $Object.hasOwnProperty.call(message, "effectDetail"))
                $root.transit_realtime.TranslatedString.encode(message.effectDetail, writer.uint32(/* id 18, wireType 2 =*/146).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes an Alert message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.Alert
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.Alert & transit_realtime.Alert.$Shape} Alert
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Alert.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.Alert(), value;
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if (!(message.activePeriod && message.activePeriod.length))
                            message.activePeriod = [];
                        message.activePeriod.push($root.transit_realtime.TimeRange.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if (!(message.communicationPeriod && message.communicationPeriod.length))
                            message.communicationPeriod = [];
                        message.communicationPeriod.push($root.transit_realtime.TimeRange.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        if (!(message.impactPeriod && message.impactPeriod.length))
                            message.impactPeriod = [];
                        message.impactPeriod.push($root.transit_realtime.TimeRange.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        if (!(message.informedEntity && message.informedEntity.length))
                            message.informedEntity = [];
                        message.informedEntity.push($root.transit_realtime.EntitySelector.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                case 6: {
                        if (wireType !== 0)
                            break;
                        value = reader.int32();
                        if ($root.transit_realtime.Alert.Cause[value] !== $undefined)
                            message.cause = value;
                        else if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                        continue;
                    }
                case 7: {
                        if (wireType !== 0)
                            break;
                        value = reader.int32();
                        if ($root.transit_realtime.Alert.Effect[value] !== $undefined)
                            message.effect = value;
                        else if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                        continue;
                    }
                case 8: {
                        if (wireType !== 2)
                            break;
                        message.url = $root.transit_realtime.TranslatedString.decode(reader, reader.uint32(), $undefined, _depth + 1, message.url);
                        continue;
                    }
                case 10: {
                        if (wireType !== 2)
                            break;
                        message.headerText = $root.transit_realtime.TranslatedString.decode(reader, reader.uint32(), $undefined, _depth + 1, message.headerText);
                        continue;
                    }
                case 11: {
                        if (wireType !== 2)
                            break;
                        message.descriptionText = $root.transit_realtime.TranslatedString.decode(reader, reader.uint32(), $undefined, _depth + 1, message.descriptionText);
                        continue;
                    }
                case 12: {
                        if (wireType !== 2)
                            break;
                        message.ttsHeaderText = $root.transit_realtime.TranslatedString.decode(reader, reader.uint32(), $undefined, _depth + 1, message.ttsHeaderText);
                        continue;
                    }
                case 13: {
                        if (wireType !== 2)
                            break;
                        message.ttsDescriptionText = $root.transit_realtime.TranslatedString.decode(reader, reader.uint32(), $undefined, _depth + 1, message.ttsDescriptionText);
                        continue;
                    }
                case 14: {
                        if (wireType !== 0)
                            break;
                        value = reader.int32();
                        if ($root.transit_realtime.Alert.SeverityLevel[value] !== $undefined)
                            message.severityLevel = value;
                        else if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                        continue;
                    }
                case 15: {
                        if (wireType !== 2)
                            break;
                        message.image = $root.transit_realtime.TranslatedImage.decode(reader, reader.uint32(), $undefined, _depth + 1, message.image);
                        continue;
                    }
                case 16: {
                        if (wireType !== 2)
                            break;
                        message.imageAlternativeText = $root.transit_realtime.TranslatedString.decode(reader, reader.uint32(), $undefined, _depth + 1, message.imageAlternativeText);
                        continue;
                    }
                case 17: {
                        if (wireType !== 2)
                            break;
                        message.causeDetail = $root.transit_realtime.TranslatedString.decode(reader, reader.uint32(), $undefined, _depth + 1, message.causeDetail);
                        continue;
                    }
                case 18: {
                        if (wireType !== 2)
                            break;
                        message.effectDetail = $root.transit_realtime.TranslatedString.decode(reader, reader.uint32(), $undefined, _depth + 1, message.effectDetail);
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for Alert
         * @function getTypeUrl
         * @memberof transit_realtime.Alert
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        Alert.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.Alert";
        };

        /**
         * Cause enum.
         * @name transit_realtime.Alert.Cause
         * @enum {number}
         * @property {number} UNKNOWN_CAUSE=1 UNKNOWN_CAUSE value
         * @property {number} OTHER_CAUSE=2 OTHER_CAUSE value
         * @property {number} TECHNICAL_PROBLEM=3 TECHNICAL_PROBLEM value
         * @property {number} STRIKE=4 STRIKE value
         * @property {number} DEMONSTRATION=5 DEMONSTRATION value
         * @property {number} ACCIDENT=6 ACCIDENT value
         * @property {number} HOLIDAY=7 HOLIDAY value
         * @property {number} WEATHER=8 WEATHER value
         * @property {number} MAINTENANCE=9 MAINTENANCE value
         * @property {number} CONSTRUCTION=10 CONSTRUCTION value
         * @property {number} POLICE_ACTIVITY=11 POLICE_ACTIVITY value
         * @property {number} MEDICAL_EMERGENCY=12 MEDICAL_EMERGENCY value
         * @property {number} SPECIAL_EVENT=13 SPECIAL_EVENT value
         */
        Alert.Cause = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[1] = "UNKNOWN_CAUSE"] = 1;
            values[valuesById[2] = "OTHER_CAUSE"] = 2;
            values[valuesById[3] = "TECHNICAL_PROBLEM"] = 3;
            values[valuesById[4] = "STRIKE"] = 4;
            values[valuesById[5] = "DEMONSTRATION"] = 5;
            values[valuesById[6] = "ACCIDENT"] = 6;
            values[valuesById[7] = "HOLIDAY"] = 7;
            values[valuesById[8] = "WEATHER"] = 8;
            values[valuesById[9] = "MAINTENANCE"] = 9;
            values[valuesById[10] = "CONSTRUCTION"] = 10;
            values[valuesById[11] = "POLICE_ACTIVITY"] = 11;
            values[valuesById[12] = "MEDICAL_EMERGENCY"] = 12;
            values[valuesById[13] = "SPECIAL_EVENT"] = 13;
            return values;
        })();

        /**
         * Effect enum.
         * @name transit_realtime.Alert.Effect
         * @enum {number}
         * @property {number} NO_SERVICE=1 NO_SERVICE value
         * @property {number} REDUCED_SERVICE=2 REDUCED_SERVICE value
         * @property {number} SIGNIFICANT_DELAYS=3 SIGNIFICANT_DELAYS value
         * @property {number} DETOUR=4 DETOUR value
         * @property {number} ADDITIONAL_SERVICE=5 ADDITIONAL_SERVICE value
         * @property {number} MODIFIED_SERVICE=6 MODIFIED_SERVICE value
         * @property {number} OTHER_EFFECT=7 OTHER_EFFECT value
         * @property {number} UNKNOWN_EFFECT=8 UNKNOWN_EFFECT value
         * @property {number} STOP_MOVED=9 STOP_MOVED value
         * @property {number} NO_EFFECT=10 NO_EFFECT value
         * @property {number} ACCESSIBILITY_ISSUE=11 ACCESSIBILITY_ISSUE value
         */
        Alert.Effect = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[1] = "NO_SERVICE"] = 1;
            values[valuesById[2] = "REDUCED_SERVICE"] = 2;
            values[valuesById[3] = "SIGNIFICANT_DELAYS"] = 3;
            values[valuesById[4] = "DETOUR"] = 4;
            values[valuesById[5] = "ADDITIONAL_SERVICE"] = 5;
            values[valuesById[6] = "MODIFIED_SERVICE"] = 6;
            values[valuesById[7] = "OTHER_EFFECT"] = 7;
            values[valuesById[8] = "UNKNOWN_EFFECT"] = 8;
            values[valuesById[9] = "STOP_MOVED"] = 9;
            values[valuesById[10] = "NO_EFFECT"] = 10;
            values[valuesById[11] = "ACCESSIBILITY_ISSUE"] = 11;
            return values;
        })();

        /**
         * SeverityLevel enum.
         * @name transit_realtime.Alert.SeverityLevel
         * @enum {number}
         * @property {number} UNKNOWN_SEVERITY=1 UNKNOWN_SEVERITY value
         * @property {number} INFO=2 INFO value
         * @property {number} WARNING=3 WARNING value
         * @property {number} SEVERE=4 SEVERE value
         */
        Alert.SeverityLevel = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[1] = "UNKNOWN_SEVERITY"] = 1;
            values[valuesById[2] = "INFO"] = 2;
            values[valuesById[3] = "WARNING"] = 3;
            values[valuesById[4] = "SEVERE"] = 4;
            return values;
        })();

        return Alert;
    })();

    transit_realtime.TimeRange = (function() {

        /**
         * Properties of a TimeRange.
         * @typedef {Object} transit_realtime.TimeRange.$Properties
         * @property {number|Long|null} [start] TimeRange start
         * @property {number|Long|null} [end] TimeRange end
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a TimeRange.
         * @memberof transit_realtime
         * @interface ITimeRange
         * @augments transit_realtime.TimeRange.$Properties
         * @deprecated Use transit_realtime.TimeRange.$Properties instead.
         */

        /**
         * Shape of a TimeRange.
         * @typedef {transit_realtime.TimeRange.$Properties} transit_realtime.TimeRange.$Shape
         */

        /**
         * Constructs a new TimeRange.
         * @memberof transit_realtime
         * @classdesc Represents a TimeRange.
         * @constructor
         * @param {transit_realtime.TimeRange.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const TimeRange = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * TimeRange start.
         * @member {number|Long} start
         * @memberof transit_realtime.TimeRange
         * @instance
         */
        TimeRange.prototype.start = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * TimeRange end.
         * @member {number|Long} end
         * @memberof transit_realtime.TimeRange
         * @instance
         */
        TimeRange.prototype.end = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * Encodes the specified TimeRange message. Does not implicitly {@link transit_realtime.TimeRange.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.TimeRange
         * @static
         * @param {transit_realtime.TimeRange.$Properties} message TimeRange message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        TimeRange.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.start != null && $Object.hasOwnProperty.call(message, "start"))
                writer.uint32(/* id 1, wireType 0 =*/8).uint64(message.start);
            if (message.end != null && $Object.hasOwnProperty.call(message, "end"))
                writer.uint32(/* id 2, wireType 0 =*/16).uint64(message.end);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a TimeRange message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.TimeRange
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.TimeRange & transit_realtime.TimeRange.$Shape} TimeRange
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        TimeRange.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TimeRange();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 0)
                            break;
                        message.start = reader.uint64();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.end = reader.uint64();
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for TimeRange
         * @function getTypeUrl
         * @memberof transit_realtime.TimeRange
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        TimeRange.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.TimeRange";
        };

        return TimeRange;
    })();

    transit_realtime.Position = (function() {

        /**
         * Properties of a Position.
         * @typedef {Object} transit_realtime.Position.$Properties
         * @property {number} latitude Position latitude
         * @property {number} longitude Position longitude
         * @property {number|null} [bearing] Position bearing
         * @property {number|null} [odometer] Position odometer
         * @property {number|null} [speed] Position speed
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a Position.
         * @memberof transit_realtime
         * @interface IPosition
         * @augments transit_realtime.Position.$Properties
         * @deprecated Use transit_realtime.Position.$Properties instead.
         */

        /**
         * Shape of a Position.
         * @typedef {transit_realtime.Position.$Properties} transit_realtime.Position.$Shape
         */

        /**
         * Constructs a new Position.
         * @memberof transit_realtime
         * @classdesc Represents a Position.
         * @constructor
         * @param {transit_realtime.Position.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const Position = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * Position latitude.
         * @member {number} latitude
         * @memberof transit_realtime.Position
         * @instance
         */
        Position.prototype.latitude = 0;

        /**
         * Position longitude.
         * @member {number} longitude
         * @memberof transit_realtime.Position
         * @instance
         */
        Position.prototype.longitude = 0;

        /**
         * Position bearing.
         * @member {number} bearing
         * @memberof transit_realtime.Position
         * @instance
         */
        Position.prototype.bearing = 0;

        /**
         * Position odometer.
         * @member {number} odometer
         * @memberof transit_realtime.Position
         * @instance
         */
        Position.prototype.odometer = 0;

        /**
         * Position speed.
         * @member {number} speed
         * @memberof transit_realtime.Position
         * @instance
         */
        Position.prototype.speed = 0;

        /**
         * Encodes the specified Position message. Does not implicitly {@link transit_realtime.Position.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.Position
         * @static
         * @param {transit_realtime.Position.$Properties} message Position message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Position.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            writer.uint32(/* id 1, wireType 5 =*/13).float(message.latitude);
            writer.uint32(/* id 2, wireType 5 =*/21).float(message.longitude);
            if (message.bearing != null && $Object.hasOwnProperty.call(message, "bearing"))
                writer.uint32(/* id 3, wireType 5 =*/29).float(message.bearing);
            if (message.odometer != null && $Object.hasOwnProperty.call(message, "odometer"))
                writer.uint32(/* id 4, wireType 1 =*/33).double(message.odometer);
            if (message.speed != null && $Object.hasOwnProperty.call(message, "speed"))
                writer.uint32(/* id 5, wireType 5 =*/45).float(message.speed);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a Position message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.Position
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.Position & transit_realtime.Position.$Shape} Position
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Position.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.Position();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 5)
                            break;
                        message.latitude = reader.float();
                        continue;
                    }
                case 2: {
                        if (wireType !== 5)
                            break;
                        message.longitude = reader.float();
                        continue;
                    }
                case 3: {
                        if (wireType !== 5)
                            break;
                        message.bearing = reader.float();
                        continue;
                    }
                case 4: {
                        if (wireType !== 1)
                            break;
                        message.odometer = reader.double();
                        continue;
                    }
                case 5: {
                        if (wireType !== 5)
                            break;
                        message.speed = reader.float();
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            if (!$Object.hasOwnProperty.call(message, "latitude"))
                throw $util.ProtocolError("missing required 'latitude'", { instance: message });
            if (!$Object.hasOwnProperty.call(message, "longitude"))
                throw $util.ProtocolError("missing required 'longitude'", { instance: message });
            return message;
        };

        /**
         * Gets the type url for Position
         * @function getTypeUrl
         * @memberof transit_realtime.Position
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        Position.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.Position";
        };

        return Position;
    })();

    transit_realtime.TripDescriptor = (function() {

        /**
         * Properties of a TripDescriptor.
         * @typedef {Object} transit_realtime.TripDescriptor.$Properties
         * @property {string|null} [tripId] TripDescriptor tripId
         * @property {string|null} [routeId] TripDescriptor routeId
         * @property {number|null} [directionId] TripDescriptor directionId
         * @property {string|null} [startTime] TripDescriptor startTime
         * @property {string|null} [startDate] TripDescriptor startDate
         * @property {transit_realtime.TripDescriptor.ScheduleRelationship|null} [scheduleRelationship] TripDescriptor scheduleRelationship
         * @property {transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties|null} [modifiedTrip] TripDescriptor modifiedTrip
         * @property {transit_realtime.NyctTripDescriptor.$Properties|null} [".transit_realtime.nyctTripDescriptor"] TripDescriptor .transit_realtime.nyctTripDescriptor
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a TripDescriptor.
         * @memberof transit_realtime
         * @interface ITripDescriptor
         * @augments transit_realtime.TripDescriptor.$Properties
         * @deprecated Use transit_realtime.TripDescriptor.$Properties instead.
         */

        /**
         * Shape of a TripDescriptor.
         * @typedef {transit_realtime.TripDescriptor.$Properties} transit_realtime.TripDescriptor.$Shape
         */

        /**
         * Constructs a new TripDescriptor.
         * @memberof transit_realtime
         * @classdesc Represents a TripDescriptor.
         * @constructor
         * @param {transit_realtime.TripDescriptor.$Properties=} [properties] Properties to set
         * @property {transit_realtime.NyctTripDescriptor.$Properties|null} [".transit_realtime.nyctTripDescriptor"] TripDescriptor .transit_realtime.nyctTripDescriptor
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const TripDescriptor = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * TripDescriptor tripId.
         * @member {string} tripId
         * @memberof transit_realtime.TripDescriptor
         * @instance
         */
        TripDescriptor.prototype.tripId = "";

        /**
         * TripDescriptor routeId.
         * @member {string} routeId
         * @memberof transit_realtime.TripDescriptor
         * @instance
         */
        TripDescriptor.prototype.routeId = "";

        /**
         * TripDescriptor directionId.
         * @member {number} directionId
         * @memberof transit_realtime.TripDescriptor
         * @instance
         */
        TripDescriptor.prototype.directionId = 0;

        /**
         * TripDescriptor startTime.
         * @member {string} startTime
         * @memberof transit_realtime.TripDescriptor
         * @instance
         */
        TripDescriptor.prototype.startTime = "";

        /**
         * TripDescriptor startDate.
         * @member {string} startDate
         * @memberof transit_realtime.TripDescriptor
         * @instance
         */
        TripDescriptor.prototype.startDate = "";

        /**
         * TripDescriptor scheduleRelationship.
         * @member {transit_realtime.TripDescriptor.ScheduleRelationship} scheduleRelationship
         * @memberof transit_realtime.TripDescriptor
         * @instance
         */
        TripDescriptor.prototype.scheduleRelationship = 0;

        /**
         * TripDescriptor modifiedTrip.
         * @member {transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties|null|undefined} modifiedTrip
         * @memberof transit_realtime.TripDescriptor
         * @instance
         */
        TripDescriptor.prototype.modifiedTrip = null;

        TripDescriptor.prototype[".transit_realtime.nyctTripDescriptor"] = null;

        /**
         * Encodes the specified TripDescriptor message. Does not implicitly {@link transit_realtime.TripDescriptor.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.TripDescriptor
         * @static
         * @param {transit_realtime.TripDescriptor.$Properties} message TripDescriptor message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        TripDescriptor.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.tripId != null && $Object.hasOwnProperty.call(message, "tripId"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.tripId);
            if (message.startTime != null && $Object.hasOwnProperty.call(message, "startTime"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.startTime);
            if (message.startDate != null && $Object.hasOwnProperty.call(message, "startDate"))
                writer.uint32(/* id 3, wireType 2 =*/26).string(message.startDate);
            if (message.scheduleRelationship != null && $Object.hasOwnProperty.call(message, "scheduleRelationship"))
                writer.uint32(/* id 4, wireType 0 =*/32).int32(message.scheduleRelationship);
            if (message.routeId != null && $Object.hasOwnProperty.call(message, "routeId"))
                writer.uint32(/* id 5, wireType 2 =*/42).string(message.routeId);
            if (message.directionId != null && $Object.hasOwnProperty.call(message, "directionId"))
                writer.uint32(/* id 6, wireType 0 =*/48).uint32(message.directionId);
            if (message.modifiedTrip != null && $Object.hasOwnProperty.call(message, "modifiedTrip"))
                $root.transit_realtime.TripDescriptor.ModifiedTripSelector.encode(message.modifiedTrip, writer.uint32(/* id 7, wireType 2 =*/58).fork(), _depth + 1).ldelim();
            if (message[".transit_realtime.nyctTripDescriptor"] != null && $Object.hasOwnProperty.call(message, ".transit_realtime.nyctTripDescriptor"))
                $root.transit_realtime.NyctTripDescriptor.encode(message[".transit_realtime.nyctTripDescriptor"], writer.uint32(/* id 1001, wireType 2 =*/8010).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a TripDescriptor message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.TripDescriptor
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.TripDescriptor & transit_realtime.TripDescriptor.$Shape} TripDescriptor
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        TripDescriptor.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TripDescriptor(), value;
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        message.tripId = reader.string();
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        message.routeId = reader.string();
                        continue;
                    }
                case 6: {
                        if (wireType !== 0)
                            break;
                        message.directionId = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.startTime = reader.string();
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.startDate = reader.string();
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        value = reader.int32();
                        if ($root.transit_realtime.TripDescriptor.ScheduleRelationship[value] !== $undefined)
                            message.scheduleRelationship = value;
                        else if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                        continue;
                    }
                case 7: {
                        if (wireType !== 2)
                            break;
                        message.modifiedTrip = $root.transit_realtime.TripDescriptor.ModifiedTripSelector.decode(reader, reader.uint32(), $undefined, _depth + 1, message.modifiedTrip);
                        continue;
                    }
                case 1001: {
                        if (wireType !== 2)
                            break;
                        message[".transit_realtime.nyctTripDescriptor"] = $root.transit_realtime.NyctTripDescriptor.decode(reader, reader.uint32(), $undefined, _depth + 1, message[".transit_realtime.nyctTripDescriptor"]);
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for TripDescriptor
         * @function getTypeUrl
         * @memberof transit_realtime.TripDescriptor
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        TripDescriptor.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.TripDescriptor";
        };

        /**
         * ScheduleRelationship enum.
         * @name transit_realtime.TripDescriptor.ScheduleRelationship
         * @enum {number}
         * @property {number} SCHEDULED=0 SCHEDULED value
         * @property {number} ADDED=1 ADDED value
         * @property {number} UNSCHEDULED=2 UNSCHEDULED value
         * @property {number} CANCELED=3 CANCELED value
         * @property {number} REPLACEMENT=5 REPLACEMENT value
         * @property {number} DUPLICATED=6 DUPLICATED value
         * @property {number} DELETED=7 DELETED value
         * @property {number} NEW=8 NEW value
         */
        TripDescriptor.ScheduleRelationship = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[0] = "SCHEDULED"] = 0;
            values[valuesById[1] = "ADDED"] = 1;
            values[valuesById[2] = "UNSCHEDULED"] = 2;
            values[valuesById[3] = "CANCELED"] = 3;
            values[valuesById[5] = "REPLACEMENT"] = 5;
            values[valuesById[6] = "DUPLICATED"] = 6;
            values[valuesById[7] = "DELETED"] = 7;
            values[valuesById[8] = "NEW"] = 8;
            return values;
        })();

        TripDescriptor.ModifiedTripSelector = (function() {

            /**
             * Properties of a ModifiedTripSelector.
             * @typedef {Object} transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties
             * @property {string|null} [modificationsId] ModifiedTripSelector modificationsId
             * @property {string|null} [affectedTripId] ModifiedTripSelector affectedTripId
             * @property {string|null} [startTime] ModifiedTripSelector startTime
             * @property {string|null} [startDate] ModifiedTripSelector startDate
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */

            /**
             * Properties of a ModifiedTripSelector.
             * @memberof transit_realtime.TripDescriptor
             * @interface IModifiedTripSelector
             * @augments transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties
             * @deprecated Use transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties instead.
             */

            /**
             * Shape of a ModifiedTripSelector.
             * @typedef {transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties} transit_realtime.TripDescriptor.ModifiedTripSelector.$Shape
             */

            /**
             * Constructs a new ModifiedTripSelector.
             * @memberof transit_realtime.TripDescriptor
             * @classdesc Represents a ModifiedTripSelector.
             * @constructor
             * @param {transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties=} [properties] Properties to set
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */
            const ModifiedTripSelector = function (properties) {
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            /**
             * ModifiedTripSelector modificationsId.
             * @member {string} modificationsId
             * @memberof transit_realtime.TripDescriptor.ModifiedTripSelector
             * @instance
             */
            ModifiedTripSelector.prototype.modificationsId = "";

            /**
             * ModifiedTripSelector affectedTripId.
             * @member {string} affectedTripId
             * @memberof transit_realtime.TripDescriptor.ModifiedTripSelector
             * @instance
             */
            ModifiedTripSelector.prototype.affectedTripId = "";

            /**
             * ModifiedTripSelector startTime.
             * @member {string} startTime
             * @memberof transit_realtime.TripDescriptor.ModifiedTripSelector
             * @instance
             */
            ModifiedTripSelector.prototype.startTime = "";

            /**
             * ModifiedTripSelector startDate.
             * @member {string} startDate
             * @memberof transit_realtime.TripDescriptor.ModifiedTripSelector
             * @instance
             */
            ModifiedTripSelector.prototype.startDate = "";

            /**
             * Encodes the specified ModifiedTripSelector message. Does not implicitly {@link transit_realtime.TripDescriptor.ModifiedTripSelector.verify|verify} messages.
             * @function encode
             * @memberof transit_realtime.TripDescriptor.ModifiedTripSelector
             * @static
             * @param {transit_realtime.TripDescriptor.ModifiedTripSelector.$Properties} message ModifiedTripSelector message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            ModifiedTripSelector.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (message.modificationsId != null && $Object.hasOwnProperty.call(message, "modificationsId"))
                    writer.uint32(/* id 1, wireType 2 =*/10).string(message.modificationsId);
                if (message.affectedTripId != null && $Object.hasOwnProperty.call(message, "affectedTripId"))
                    writer.uint32(/* id 2, wireType 2 =*/18).string(message.affectedTripId);
                if (message.startTime != null && $Object.hasOwnProperty.call(message, "startTime"))
                    writer.uint32(/* id 3, wireType 2 =*/26).string(message.startTime);
                if (message.startDate != null && $Object.hasOwnProperty.call(message, "startDate"))
                    writer.uint32(/* id 4, wireType 2 =*/34).string(message.startDate);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            /**
             * Decodes a ModifiedTripSelector message from the specified reader or buffer.
             * @function decode
             * @memberof transit_realtime.TripDescriptor.ModifiedTripSelector
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {transit_realtime.TripDescriptor.ModifiedTripSelector & transit_realtime.TripDescriptor.ModifiedTripSelector.$Shape} ModifiedTripSelector
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            ModifiedTripSelector.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TripDescriptor.ModifiedTripSelector();
                while (reader.pos < end) {
                    let start = reader.pos;
                    let tag = reader.tag();
                    if (tag === _end) {
                        _end = $undefined;
                        break;
                    }
                    let wireType = tag & 7;
                    switch (tag >>>= 3) {
                    case 1: {
                            if (wireType !== 2)
                                break;
                            message.modificationsId = reader.string();
                            continue;
                        }
                    case 2: {
                            if (wireType !== 2)
                                break;
                            message.affectedTripId = reader.string();
                            continue;
                        }
                    case 3: {
                            if (wireType !== 2)
                                break;
                            message.startTime = reader.string();
                            continue;
                        }
                    case 4: {
                            if (wireType !== 2)
                                break;
                            message.startDate = reader.string();
                            continue;
                        }
                    }
                    reader.skipType(wireType, _depth, tag);
                    if (!reader.discardUnknown) {
                        $util.makeProp(message, "$unknowns", false);
                        (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                    }
                }
                if (_end !== $undefined)
                    throw $Error("missing end group");
                return message;
            };

            /**
             * Gets the type url for ModifiedTripSelector
             * @function getTypeUrl
             * @memberof transit_realtime.TripDescriptor.ModifiedTripSelector
             * @static
             * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns {string} The type url
             */
            ModifiedTripSelector.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/transit_realtime.TripDescriptor.ModifiedTripSelector";
            };

            return ModifiedTripSelector;
        })();

        return TripDescriptor;
    })();

    transit_realtime.VehicleDescriptor = (function() {

        /**
         * Properties of a VehicleDescriptor.
         * @typedef {Object} transit_realtime.VehicleDescriptor.$Properties
         * @property {string|null} [id] VehicleDescriptor id
         * @property {string|null} [label] VehicleDescriptor label
         * @property {string|null} [licensePlate] VehicleDescriptor licensePlate
         * @property {transit_realtime.VehicleDescriptor.WheelchairAccessible|null} [wheelchairAccessible] VehicleDescriptor wheelchairAccessible
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a VehicleDescriptor.
         * @memberof transit_realtime
         * @interface IVehicleDescriptor
         * @augments transit_realtime.VehicleDescriptor.$Properties
         * @deprecated Use transit_realtime.VehicleDescriptor.$Properties instead.
         */

        /**
         * Shape of a VehicleDescriptor.
         * @typedef {transit_realtime.VehicleDescriptor.$Properties} transit_realtime.VehicleDescriptor.$Shape
         */

        /**
         * Constructs a new VehicleDescriptor.
         * @memberof transit_realtime
         * @classdesc Represents a VehicleDescriptor.
         * @constructor
         * @param {transit_realtime.VehicleDescriptor.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const VehicleDescriptor = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * VehicleDescriptor id.
         * @member {string} id
         * @memberof transit_realtime.VehicleDescriptor
         * @instance
         */
        VehicleDescriptor.prototype.id = "";

        /**
         * VehicleDescriptor label.
         * @member {string} label
         * @memberof transit_realtime.VehicleDescriptor
         * @instance
         */
        VehicleDescriptor.prototype.label = "";

        /**
         * VehicleDescriptor licensePlate.
         * @member {string} licensePlate
         * @memberof transit_realtime.VehicleDescriptor
         * @instance
         */
        VehicleDescriptor.prototype.licensePlate = "";

        /**
         * VehicleDescriptor wheelchairAccessible.
         * @member {transit_realtime.VehicleDescriptor.WheelchairAccessible} wheelchairAccessible
         * @memberof transit_realtime.VehicleDescriptor
         * @instance
         */
        VehicleDescriptor.prototype.wheelchairAccessible = 0;

        /**
         * Encodes the specified VehicleDescriptor message. Does not implicitly {@link transit_realtime.VehicleDescriptor.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.VehicleDescriptor
         * @static
         * @param {transit_realtime.VehicleDescriptor.$Properties} message VehicleDescriptor message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        VehicleDescriptor.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.id != null && $Object.hasOwnProperty.call(message, "id"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.id);
            if (message.label != null && $Object.hasOwnProperty.call(message, "label"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.label);
            if (message.licensePlate != null && $Object.hasOwnProperty.call(message, "licensePlate"))
                writer.uint32(/* id 3, wireType 2 =*/26).string(message.licensePlate);
            if (message.wheelchairAccessible != null && $Object.hasOwnProperty.call(message, "wheelchairAccessible"))
                writer.uint32(/* id 4, wireType 0 =*/32).int32(message.wheelchairAccessible);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a VehicleDescriptor message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.VehicleDescriptor
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.VehicleDescriptor & transit_realtime.VehicleDescriptor.$Shape} VehicleDescriptor
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        VehicleDescriptor.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.VehicleDescriptor(), value;
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        message.id = reader.string();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.label = reader.string();
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.licensePlate = reader.string();
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        value = reader.int32();
                        if ($root.transit_realtime.VehicleDescriptor.WheelchairAccessible[value] !== $undefined)
                            message.wheelchairAccessible = value;
                        else if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for VehicleDescriptor
         * @function getTypeUrl
         * @memberof transit_realtime.VehicleDescriptor
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        VehicleDescriptor.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.VehicleDescriptor";
        };

        /**
         * WheelchairAccessible enum.
         * @name transit_realtime.VehicleDescriptor.WheelchairAccessible
         * @enum {number}
         * @property {number} NO_VALUE=0 NO_VALUE value
         * @property {number} UNKNOWN=1 UNKNOWN value
         * @property {number} WHEELCHAIR_ACCESSIBLE=2 WHEELCHAIR_ACCESSIBLE value
         * @property {number} WHEELCHAIR_INACCESSIBLE=3 WHEELCHAIR_INACCESSIBLE value
         */
        VehicleDescriptor.WheelchairAccessible = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[0] = "NO_VALUE"] = 0;
            values[valuesById[1] = "UNKNOWN"] = 1;
            values[valuesById[2] = "WHEELCHAIR_ACCESSIBLE"] = 2;
            values[valuesById[3] = "WHEELCHAIR_INACCESSIBLE"] = 3;
            return values;
        })();

        return VehicleDescriptor;
    })();

    transit_realtime.EntitySelector = (function() {

        /**
         * Properties of an EntitySelector.
         * @typedef {Object} transit_realtime.EntitySelector.$Properties
         * @property {string|null} [agencyId] EntitySelector agencyId
         * @property {string|null} [routeId] EntitySelector routeId
         * @property {number|null} [routeType] EntitySelector routeType
         * @property {transit_realtime.TripDescriptor.$Properties|null} [trip] EntitySelector trip
         * @property {string|null} [stopId] EntitySelector stopId
         * @property {number|null} [directionId] EntitySelector directionId
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of an EntitySelector.
         * @memberof transit_realtime
         * @interface IEntitySelector
         * @augments transit_realtime.EntitySelector.$Properties
         * @deprecated Use transit_realtime.EntitySelector.$Properties instead.
         */

        /**
         * Shape of an EntitySelector.
         * @typedef {transit_realtime.EntitySelector.$Properties} transit_realtime.EntitySelector.$Shape
         */

        /**
         * Constructs a new EntitySelector.
         * @memberof transit_realtime
         * @classdesc Represents an EntitySelector.
         * @constructor
         * @param {transit_realtime.EntitySelector.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const EntitySelector = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * EntitySelector agencyId.
         * @member {string} agencyId
         * @memberof transit_realtime.EntitySelector
         * @instance
         */
        EntitySelector.prototype.agencyId = "";

        /**
         * EntitySelector routeId.
         * @member {string} routeId
         * @memberof transit_realtime.EntitySelector
         * @instance
         */
        EntitySelector.prototype.routeId = "";

        /**
         * EntitySelector routeType.
         * @member {number} routeType
         * @memberof transit_realtime.EntitySelector
         * @instance
         */
        EntitySelector.prototype.routeType = 0;

        /**
         * EntitySelector trip.
         * @member {transit_realtime.TripDescriptor.$Properties|null|undefined} trip
         * @memberof transit_realtime.EntitySelector
         * @instance
         */
        EntitySelector.prototype.trip = null;

        /**
         * EntitySelector stopId.
         * @member {string} stopId
         * @memberof transit_realtime.EntitySelector
         * @instance
         */
        EntitySelector.prototype.stopId = "";

        /**
         * EntitySelector directionId.
         * @member {number} directionId
         * @memberof transit_realtime.EntitySelector
         * @instance
         */
        EntitySelector.prototype.directionId = 0;

        /**
         * Encodes the specified EntitySelector message. Does not implicitly {@link transit_realtime.EntitySelector.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.EntitySelector
         * @static
         * @param {transit_realtime.EntitySelector.$Properties} message EntitySelector message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        EntitySelector.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.agencyId != null && $Object.hasOwnProperty.call(message, "agencyId"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.agencyId);
            if (message.routeId != null && $Object.hasOwnProperty.call(message, "routeId"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.routeId);
            if (message.routeType != null && $Object.hasOwnProperty.call(message, "routeType"))
                writer.uint32(/* id 3, wireType 0 =*/24).int32(message.routeType);
            if (message.trip != null && $Object.hasOwnProperty.call(message, "trip"))
                $root.transit_realtime.TripDescriptor.encode(message.trip, writer.uint32(/* id 4, wireType 2 =*/34).fork(), _depth + 1).ldelim();
            if (message.stopId != null && $Object.hasOwnProperty.call(message, "stopId"))
                writer.uint32(/* id 5, wireType 2 =*/42).string(message.stopId);
            if (message.directionId != null && $Object.hasOwnProperty.call(message, "directionId"))
                writer.uint32(/* id 6, wireType 0 =*/48).uint32(message.directionId);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes an EntitySelector message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.EntitySelector
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.EntitySelector & transit_realtime.EntitySelector.$Shape} EntitySelector
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        EntitySelector.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.EntitySelector();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        message.agencyId = reader.string();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.routeId = reader.string();
                        continue;
                    }
                case 3: {
                        if (wireType !== 0)
                            break;
                        message.routeType = reader.int32();
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        message.trip = $root.transit_realtime.TripDescriptor.decode(reader, reader.uint32(), $undefined, _depth + 1, message.trip);
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        message.stopId = reader.string();
                        continue;
                    }
                case 6: {
                        if (wireType !== 0)
                            break;
                        message.directionId = reader.uint32();
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for EntitySelector
         * @function getTypeUrl
         * @memberof transit_realtime.EntitySelector
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        EntitySelector.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.EntitySelector";
        };

        return EntitySelector;
    })();

    transit_realtime.TranslatedString = (function() {

        /**
         * Properties of a TranslatedString.
         * @typedef {Object} transit_realtime.TranslatedString.$Properties
         * @property {Array.<transit_realtime.TranslatedString.Translation.$Properties>|null} [translation] TranslatedString translation
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a TranslatedString.
         * @memberof transit_realtime
         * @interface ITranslatedString
         * @augments transit_realtime.TranslatedString.$Properties
         * @deprecated Use transit_realtime.TranslatedString.$Properties instead.
         */

        /**
         * Shape of a TranslatedString.
         * @typedef {transit_realtime.TranslatedString.$Properties} transit_realtime.TranslatedString.$Shape
         */

        /**
         * Constructs a new TranslatedString.
         * @memberof transit_realtime
         * @classdesc Represents a TranslatedString.
         * @constructor
         * @param {transit_realtime.TranslatedString.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const TranslatedString = function (properties) {
            this.translation = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * TranslatedString translation.
         * @member {Array.<transit_realtime.TranslatedString.Translation.$Properties>} translation
         * @memberof transit_realtime.TranslatedString
         * @instance
         */
        TranslatedString.prototype.translation = $util.emptyArray;

        /**
         * Encodes the specified TranslatedString message. Does not implicitly {@link transit_realtime.TranslatedString.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.TranslatedString
         * @static
         * @param {transit_realtime.TranslatedString.$Properties} message TranslatedString message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        TranslatedString.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.translation != null && message.translation.length)
                for (let i = 0; i < message.translation.length; ++i)
                    $root.transit_realtime.TranslatedString.Translation.encode(message.translation[i], writer.uint32(/* id 1, wireType 2 =*/10).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a TranslatedString message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.TranslatedString
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.TranslatedString & transit_realtime.TranslatedString.$Shape} TranslatedString
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        TranslatedString.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TranslatedString();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if (!(message.translation && message.translation.length))
                            message.translation = [];
                        message.translation.push($root.transit_realtime.TranslatedString.Translation.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for TranslatedString
         * @function getTypeUrl
         * @memberof transit_realtime.TranslatedString
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        TranslatedString.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.TranslatedString";
        };

        TranslatedString.Translation = (function() {

            /**
             * Properties of a Translation.
             * @typedef {Object} transit_realtime.TranslatedString.Translation.$Properties
             * @property {string} text Translation text
             * @property {string|null} [language] Translation language
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */

            /**
             * Properties of a Translation.
             * @memberof transit_realtime.TranslatedString
             * @interface ITranslation
             * @augments transit_realtime.TranslatedString.Translation.$Properties
             * @deprecated Use transit_realtime.TranslatedString.Translation.$Properties instead.
             */

            /**
             * Shape of a Translation.
             * @typedef {transit_realtime.TranslatedString.Translation.$Properties} transit_realtime.TranslatedString.Translation.$Shape
             */

            /**
             * Constructs a new Translation.
             * @memberof transit_realtime.TranslatedString
             * @classdesc Represents a Translation.
             * @constructor
             * @param {transit_realtime.TranslatedString.Translation.$Properties=} [properties] Properties to set
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */
            const Translation = function (properties) {
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            /**
             * Translation text.
             * @member {string} text
             * @memberof transit_realtime.TranslatedString.Translation
             * @instance
             */
            Translation.prototype.text = "";

            /**
             * Translation language.
             * @member {string} language
             * @memberof transit_realtime.TranslatedString.Translation
             * @instance
             */
            Translation.prototype.language = "";

            /**
             * Encodes the specified Translation message. Does not implicitly {@link transit_realtime.TranslatedString.Translation.verify|verify} messages.
             * @function encode
             * @memberof transit_realtime.TranslatedString.Translation
             * @static
             * @param {transit_realtime.TranslatedString.Translation.$Properties} message Translation message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            Translation.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.text);
                if (message.language != null && $Object.hasOwnProperty.call(message, "language"))
                    writer.uint32(/* id 2, wireType 2 =*/18).string(message.language);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            /**
             * Decodes a Translation message from the specified reader or buffer.
             * @function decode
             * @memberof transit_realtime.TranslatedString.Translation
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {transit_realtime.TranslatedString.Translation & transit_realtime.TranslatedString.Translation.$Shape} Translation
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            Translation.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TranslatedString.Translation();
                while (reader.pos < end) {
                    let start = reader.pos;
                    let tag = reader.tag();
                    if (tag === _end) {
                        _end = $undefined;
                        break;
                    }
                    let wireType = tag & 7;
                    switch (tag >>>= 3) {
                    case 1: {
                            if (wireType !== 2)
                                break;
                            message.text = reader.string();
                            continue;
                        }
                    case 2: {
                            if (wireType !== 2)
                                break;
                            message.language = reader.string();
                            continue;
                        }
                    }
                    reader.skipType(wireType, _depth, tag);
                    if (!reader.discardUnknown) {
                        $util.makeProp(message, "$unknowns", false);
                        (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                    }
                }
                if (_end !== $undefined)
                    throw $Error("missing end group");
                if (!$Object.hasOwnProperty.call(message, "text"))
                    throw $util.ProtocolError("missing required 'text'", { instance: message });
                return message;
            };

            /**
             * Gets the type url for Translation
             * @function getTypeUrl
             * @memberof transit_realtime.TranslatedString.Translation
             * @static
             * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns {string} The type url
             */
            Translation.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/transit_realtime.TranslatedString.Translation";
            };

            return Translation;
        })();

        return TranslatedString;
    })();

    transit_realtime.TranslatedImage = (function() {

        /**
         * Properties of a TranslatedImage.
         * @typedef {Object} transit_realtime.TranslatedImage.$Properties
         * @property {Array.<transit_realtime.TranslatedImage.LocalizedImage.$Properties>|null} [localizedImage] TranslatedImage localizedImage
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a TranslatedImage.
         * @memberof transit_realtime
         * @interface ITranslatedImage
         * @augments transit_realtime.TranslatedImage.$Properties
         * @deprecated Use transit_realtime.TranslatedImage.$Properties instead.
         */

        /**
         * Shape of a TranslatedImage.
         * @typedef {transit_realtime.TranslatedImage.$Properties} transit_realtime.TranslatedImage.$Shape
         */

        /**
         * Constructs a new TranslatedImage.
         * @memberof transit_realtime
         * @classdesc Represents a TranslatedImage.
         * @constructor
         * @param {transit_realtime.TranslatedImage.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const TranslatedImage = function (properties) {
            this.localizedImage = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * TranslatedImage localizedImage.
         * @member {Array.<transit_realtime.TranslatedImage.LocalizedImage.$Properties>} localizedImage
         * @memberof transit_realtime.TranslatedImage
         * @instance
         */
        TranslatedImage.prototype.localizedImage = $util.emptyArray;

        /**
         * Encodes the specified TranslatedImage message. Does not implicitly {@link transit_realtime.TranslatedImage.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.TranslatedImage
         * @static
         * @param {transit_realtime.TranslatedImage.$Properties} message TranslatedImage message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        TranslatedImage.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.localizedImage != null && message.localizedImage.length)
                for (let i = 0; i < message.localizedImage.length; ++i)
                    $root.transit_realtime.TranslatedImage.LocalizedImage.encode(message.localizedImage[i], writer.uint32(/* id 1, wireType 2 =*/10).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a TranslatedImage message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.TranslatedImage
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.TranslatedImage & transit_realtime.TranslatedImage.$Shape} TranslatedImage
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        TranslatedImage.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TranslatedImage();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if (!(message.localizedImage && message.localizedImage.length))
                            message.localizedImage = [];
                        message.localizedImage.push($root.transit_realtime.TranslatedImage.LocalizedImage.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for TranslatedImage
         * @function getTypeUrl
         * @memberof transit_realtime.TranslatedImage
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        TranslatedImage.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.TranslatedImage";
        };

        TranslatedImage.LocalizedImage = (function() {

            /**
             * Properties of a LocalizedImage.
             * @typedef {Object} transit_realtime.TranslatedImage.LocalizedImage.$Properties
             * @property {string} url LocalizedImage url
             * @property {string} mediaType LocalizedImage mediaType
             * @property {string|null} [language] LocalizedImage language
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */

            /**
             * Properties of a LocalizedImage.
             * @memberof transit_realtime.TranslatedImage
             * @interface ILocalizedImage
             * @augments transit_realtime.TranslatedImage.LocalizedImage.$Properties
             * @deprecated Use transit_realtime.TranslatedImage.LocalizedImage.$Properties instead.
             */

            /**
             * Shape of a LocalizedImage.
             * @typedef {transit_realtime.TranslatedImage.LocalizedImage.$Properties} transit_realtime.TranslatedImage.LocalizedImage.$Shape
             */

            /**
             * Constructs a new LocalizedImage.
             * @memberof transit_realtime.TranslatedImage
             * @classdesc Represents a LocalizedImage.
             * @constructor
             * @param {transit_realtime.TranslatedImage.LocalizedImage.$Properties=} [properties] Properties to set
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */
            const LocalizedImage = function (properties) {
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            /**
             * LocalizedImage url.
             * @member {string} url
             * @memberof transit_realtime.TranslatedImage.LocalizedImage
             * @instance
             */
            LocalizedImage.prototype.url = "";

            /**
             * LocalizedImage mediaType.
             * @member {string} mediaType
             * @memberof transit_realtime.TranslatedImage.LocalizedImage
             * @instance
             */
            LocalizedImage.prototype.mediaType = "";

            /**
             * LocalizedImage language.
             * @member {string} language
             * @memberof transit_realtime.TranslatedImage.LocalizedImage
             * @instance
             */
            LocalizedImage.prototype.language = "";

            /**
             * Encodes the specified LocalizedImage message. Does not implicitly {@link transit_realtime.TranslatedImage.LocalizedImage.verify|verify} messages.
             * @function encode
             * @memberof transit_realtime.TranslatedImage.LocalizedImage
             * @static
             * @param {transit_realtime.TranslatedImage.LocalizedImage.$Properties} message LocalizedImage message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            LocalizedImage.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.url);
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.mediaType);
                if (message.language != null && $Object.hasOwnProperty.call(message, "language"))
                    writer.uint32(/* id 3, wireType 2 =*/26).string(message.language);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            /**
             * Decodes a LocalizedImage message from the specified reader or buffer.
             * @function decode
             * @memberof transit_realtime.TranslatedImage.LocalizedImage
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {transit_realtime.TranslatedImage.LocalizedImage & transit_realtime.TranslatedImage.LocalizedImage.$Shape} LocalizedImage
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            LocalizedImage.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TranslatedImage.LocalizedImage();
                while (reader.pos < end) {
                    let start = reader.pos;
                    let tag = reader.tag();
                    if (tag === _end) {
                        _end = $undefined;
                        break;
                    }
                    let wireType = tag & 7;
                    switch (tag >>>= 3) {
                    case 1: {
                            if (wireType !== 2)
                                break;
                            message.url = reader.string();
                            continue;
                        }
                    case 2: {
                            if (wireType !== 2)
                                break;
                            message.mediaType = reader.string();
                            continue;
                        }
                    case 3: {
                            if (wireType !== 2)
                                break;
                            message.language = reader.string();
                            continue;
                        }
                    }
                    reader.skipType(wireType, _depth, tag);
                    if (!reader.discardUnknown) {
                        $util.makeProp(message, "$unknowns", false);
                        (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                    }
                }
                if (_end !== $undefined)
                    throw $Error("missing end group");
                if (!$Object.hasOwnProperty.call(message, "url"))
                    throw $util.ProtocolError("missing required 'url'", { instance: message });
                if (!$Object.hasOwnProperty.call(message, "mediaType"))
                    throw $util.ProtocolError("missing required 'mediaType'", { instance: message });
                return message;
            };

            /**
             * Gets the type url for LocalizedImage
             * @function getTypeUrl
             * @memberof transit_realtime.TranslatedImage.LocalizedImage
             * @static
             * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns {string} The type url
             */
            LocalizedImage.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/transit_realtime.TranslatedImage.LocalizedImage";
            };

            return LocalizedImage;
        })();

        return TranslatedImage;
    })();

    transit_realtime.Shape = (function() {

        /**
         * Properties of a Shape.
         * @typedef {Object} transit_realtime.Shape.$Properties
         * @property {string|null} [shapeId] Shape shapeId
         * @property {string|null} [encodedPolyline] Shape encodedPolyline
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a Shape.
         * @memberof transit_realtime
         * @interface IShape
         * @augments transit_realtime.Shape.$Properties
         * @deprecated Use transit_realtime.Shape.$Properties instead.
         */

        /**
         * Shape of a Shape.
         * @typedef {transit_realtime.Shape.$Properties} transit_realtime.Shape.$Shape
         */

        /**
         * Constructs a new Shape.
         * @memberof transit_realtime
         * @classdesc Represents a Shape.
         * @constructor
         * @param {transit_realtime.Shape.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const Shape = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * Shape shapeId.
         * @member {string} shapeId
         * @memberof transit_realtime.Shape
         * @instance
         */
        Shape.prototype.shapeId = "";

        /**
         * Shape encodedPolyline.
         * @member {string} encodedPolyline
         * @memberof transit_realtime.Shape
         * @instance
         */
        Shape.prototype.encodedPolyline = "";

        /**
         * Encodes the specified Shape message. Does not implicitly {@link transit_realtime.Shape.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.Shape
         * @static
         * @param {transit_realtime.Shape.$Properties} message Shape message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Shape.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.shapeId != null && $Object.hasOwnProperty.call(message, "shapeId"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.shapeId);
            if (message.encodedPolyline != null && $Object.hasOwnProperty.call(message, "encodedPolyline"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.encodedPolyline);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a Shape message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.Shape
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.Shape & transit_realtime.Shape.$Shape} Shape
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Shape.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.Shape();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        message.shapeId = reader.string();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.encodedPolyline = reader.string();
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for Shape
         * @function getTypeUrl
         * @memberof transit_realtime.Shape
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        Shape.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.Shape";
        };

        return Shape;
    })();

    transit_realtime.Stop = (function() {

        /**
         * Properties of a Stop.
         * @typedef {Object} transit_realtime.Stop.$Properties
         * @property {string|null} [stopId] Stop stopId
         * @property {transit_realtime.TranslatedString.$Properties|null} [stopCode] Stop stopCode
         * @property {transit_realtime.TranslatedString.$Properties|null} [stopName] Stop stopName
         * @property {transit_realtime.TranslatedString.$Properties|null} [ttsStopName] Stop ttsStopName
         * @property {transit_realtime.TranslatedString.$Properties|null} [stopDesc] Stop stopDesc
         * @property {number|null} [stopLat] Stop stopLat
         * @property {number|null} [stopLon] Stop stopLon
         * @property {string|null} [zoneId] Stop zoneId
         * @property {transit_realtime.TranslatedString.$Properties|null} [stopUrl] Stop stopUrl
         * @property {string|null} [parentStation] Stop parentStation
         * @property {string|null} [stopTimezone] Stop stopTimezone
         * @property {transit_realtime.Stop.WheelchairBoarding|null} [wheelchairBoarding] Stop wheelchairBoarding
         * @property {string|null} [levelId] Stop levelId
         * @property {transit_realtime.TranslatedString.$Properties|null} [platformCode] Stop platformCode
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a Stop.
         * @memberof transit_realtime
         * @interface IStop
         * @augments transit_realtime.Stop.$Properties
         * @deprecated Use transit_realtime.Stop.$Properties instead.
         */

        /**
         * Shape of a Stop.
         * @typedef {transit_realtime.Stop.$Properties} transit_realtime.Stop.$Shape
         */

        /**
         * Constructs a new Stop.
         * @memberof transit_realtime
         * @classdesc Represents a Stop.
         * @constructor
         * @param {transit_realtime.Stop.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const Stop = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * Stop stopId.
         * @member {string} stopId
         * @memberof transit_realtime.Stop
         * @instance
         */
        Stop.prototype.stopId = "";

        /**
         * Stop stopCode.
         * @member {transit_realtime.TranslatedString.$Properties|null|undefined} stopCode
         * @memberof transit_realtime.Stop
         * @instance
         */
        Stop.prototype.stopCode = null;

        /**
         * Stop stopName.
         * @member {transit_realtime.TranslatedString.$Properties|null|undefined} stopName
         * @memberof transit_realtime.Stop
         * @instance
         */
        Stop.prototype.stopName = null;

        /**
         * Stop ttsStopName.
         * @member {transit_realtime.TranslatedString.$Properties|null|undefined} ttsStopName
         * @memberof transit_realtime.Stop
         * @instance
         */
        Stop.prototype.ttsStopName = null;

        /**
         * Stop stopDesc.
         * @member {transit_realtime.TranslatedString.$Properties|null|undefined} stopDesc
         * @memberof transit_realtime.Stop
         * @instance
         */
        Stop.prototype.stopDesc = null;

        /**
         * Stop stopLat.
         * @member {number} stopLat
         * @memberof transit_realtime.Stop
         * @instance
         */
        Stop.prototype.stopLat = 0;

        /**
         * Stop stopLon.
         * @member {number} stopLon
         * @memberof transit_realtime.Stop
         * @instance
         */
        Stop.prototype.stopLon = 0;

        /**
         * Stop zoneId.
         * @member {string} zoneId
         * @memberof transit_realtime.Stop
         * @instance
         */
        Stop.prototype.zoneId = "";

        /**
         * Stop stopUrl.
         * @member {transit_realtime.TranslatedString.$Properties|null|undefined} stopUrl
         * @memberof transit_realtime.Stop
         * @instance
         */
        Stop.prototype.stopUrl = null;

        /**
         * Stop parentStation.
         * @member {string} parentStation
         * @memberof transit_realtime.Stop
         * @instance
         */
        Stop.prototype.parentStation = "";

        /**
         * Stop stopTimezone.
         * @member {string} stopTimezone
         * @memberof transit_realtime.Stop
         * @instance
         */
        Stop.prototype.stopTimezone = "";

        /**
         * Stop wheelchairBoarding.
         * @member {transit_realtime.Stop.WheelchairBoarding} wheelchairBoarding
         * @memberof transit_realtime.Stop
         * @instance
         */
        Stop.prototype.wheelchairBoarding = 0;

        /**
         * Stop levelId.
         * @member {string} levelId
         * @memberof transit_realtime.Stop
         * @instance
         */
        Stop.prototype.levelId = "";

        /**
         * Stop platformCode.
         * @member {transit_realtime.TranslatedString.$Properties|null|undefined} platformCode
         * @memberof transit_realtime.Stop
         * @instance
         */
        Stop.prototype.platformCode = null;

        /**
         * Encodes the specified Stop message. Does not implicitly {@link transit_realtime.Stop.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.Stop
         * @static
         * @param {transit_realtime.Stop.$Properties} message Stop message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Stop.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.stopId != null && $Object.hasOwnProperty.call(message, "stopId"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.stopId);
            if (message.stopCode != null && $Object.hasOwnProperty.call(message, "stopCode"))
                $root.transit_realtime.TranslatedString.encode(message.stopCode, writer.uint32(/* id 2, wireType 2 =*/18).fork(), _depth + 1).ldelim();
            if (message.stopName != null && $Object.hasOwnProperty.call(message, "stopName"))
                $root.transit_realtime.TranslatedString.encode(message.stopName, writer.uint32(/* id 3, wireType 2 =*/26).fork(), _depth + 1).ldelim();
            if (message.ttsStopName != null && $Object.hasOwnProperty.call(message, "ttsStopName"))
                $root.transit_realtime.TranslatedString.encode(message.ttsStopName, writer.uint32(/* id 4, wireType 2 =*/34).fork(), _depth + 1).ldelim();
            if (message.stopDesc != null && $Object.hasOwnProperty.call(message, "stopDesc"))
                $root.transit_realtime.TranslatedString.encode(message.stopDesc, writer.uint32(/* id 5, wireType 2 =*/42).fork(), _depth + 1).ldelim();
            if (message.stopLat != null && $Object.hasOwnProperty.call(message, "stopLat"))
                writer.uint32(/* id 6, wireType 5 =*/53).float(message.stopLat);
            if (message.stopLon != null && $Object.hasOwnProperty.call(message, "stopLon"))
                writer.uint32(/* id 7, wireType 5 =*/61).float(message.stopLon);
            if (message.zoneId != null && $Object.hasOwnProperty.call(message, "zoneId"))
                writer.uint32(/* id 8, wireType 2 =*/66).string(message.zoneId);
            if (message.stopUrl != null && $Object.hasOwnProperty.call(message, "stopUrl"))
                $root.transit_realtime.TranslatedString.encode(message.stopUrl, writer.uint32(/* id 9, wireType 2 =*/74).fork(), _depth + 1).ldelim();
            if (message.parentStation != null && $Object.hasOwnProperty.call(message, "parentStation"))
                writer.uint32(/* id 11, wireType 2 =*/90).string(message.parentStation);
            if (message.stopTimezone != null && $Object.hasOwnProperty.call(message, "stopTimezone"))
                writer.uint32(/* id 12, wireType 2 =*/98).string(message.stopTimezone);
            if (message.wheelchairBoarding != null && $Object.hasOwnProperty.call(message, "wheelchairBoarding"))
                writer.uint32(/* id 13, wireType 0 =*/104).int32(message.wheelchairBoarding);
            if (message.levelId != null && $Object.hasOwnProperty.call(message, "levelId"))
                writer.uint32(/* id 14, wireType 2 =*/114).string(message.levelId);
            if (message.platformCode != null && $Object.hasOwnProperty.call(message, "platformCode"))
                $root.transit_realtime.TranslatedString.encode(message.platformCode, writer.uint32(/* id 15, wireType 2 =*/122).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a Stop message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.Stop
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.Stop & transit_realtime.Stop.$Shape} Stop
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Stop.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.Stop(), value;
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        message.stopId = reader.string();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.stopCode = $root.transit_realtime.TranslatedString.decode(reader, reader.uint32(), $undefined, _depth + 1, message.stopCode);
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.stopName = $root.transit_realtime.TranslatedString.decode(reader, reader.uint32(), $undefined, _depth + 1, message.stopName);
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        message.ttsStopName = $root.transit_realtime.TranslatedString.decode(reader, reader.uint32(), $undefined, _depth + 1, message.ttsStopName);
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        message.stopDesc = $root.transit_realtime.TranslatedString.decode(reader, reader.uint32(), $undefined, _depth + 1, message.stopDesc);
                        continue;
                    }
                case 6: {
                        if (wireType !== 5)
                            break;
                        message.stopLat = reader.float();
                        continue;
                    }
                case 7: {
                        if (wireType !== 5)
                            break;
                        message.stopLon = reader.float();
                        continue;
                    }
                case 8: {
                        if (wireType !== 2)
                            break;
                        message.zoneId = reader.string();
                        continue;
                    }
                case 9: {
                        if (wireType !== 2)
                            break;
                        message.stopUrl = $root.transit_realtime.TranslatedString.decode(reader, reader.uint32(), $undefined, _depth + 1, message.stopUrl);
                        continue;
                    }
                case 11: {
                        if (wireType !== 2)
                            break;
                        message.parentStation = reader.string();
                        continue;
                    }
                case 12: {
                        if (wireType !== 2)
                            break;
                        message.stopTimezone = reader.string();
                        continue;
                    }
                case 13: {
                        if (wireType !== 0)
                            break;
                        value = reader.int32();
                        if ($root.transit_realtime.Stop.WheelchairBoarding[value] !== $undefined)
                            message.wheelchairBoarding = value;
                        else if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                        continue;
                    }
                case 14: {
                        if (wireType !== 2)
                            break;
                        message.levelId = reader.string();
                        continue;
                    }
                case 15: {
                        if (wireType !== 2)
                            break;
                        message.platformCode = $root.transit_realtime.TranslatedString.decode(reader, reader.uint32(), $undefined, _depth + 1, message.platformCode);
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for Stop
         * @function getTypeUrl
         * @memberof transit_realtime.Stop
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        Stop.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.Stop";
        };

        /**
         * WheelchairBoarding enum.
         * @name transit_realtime.Stop.WheelchairBoarding
         * @enum {number}
         * @property {number} UNKNOWN=0 UNKNOWN value
         * @property {number} AVAILABLE=1 AVAILABLE value
         * @property {number} NOT_AVAILABLE=2 NOT_AVAILABLE value
         */
        Stop.WheelchairBoarding = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[0] = "UNKNOWN"] = 0;
            values[valuesById[1] = "AVAILABLE"] = 1;
            values[valuesById[2] = "NOT_AVAILABLE"] = 2;
            return values;
        })();

        return Stop;
    })();

    transit_realtime.TripModifications = (function() {

        /**
         * Properties of a TripModifications.
         * @typedef {Object} transit_realtime.TripModifications.$Properties
         * @property {Array.<transit_realtime.TripModifications.SelectedTrips.$Properties>|null} [selectedTrips] TripModifications selectedTrips
         * @property {Array.<string>|null} [startTimes] TripModifications startTimes
         * @property {Array.<string>|null} [serviceDates] TripModifications serviceDates
         * @property {Array.<transit_realtime.TripModifications.Modification.$Properties>|null} [modifications] TripModifications modifications
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a TripModifications.
         * @memberof transit_realtime
         * @interface ITripModifications
         * @augments transit_realtime.TripModifications.$Properties
         * @deprecated Use transit_realtime.TripModifications.$Properties instead.
         */

        /**
         * Shape of a TripModifications.
         * @typedef {transit_realtime.TripModifications.$Properties} transit_realtime.TripModifications.$Shape
         */

        /**
         * Constructs a new TripModifications.
         * @memberof transit_realtime
         * @classdesc Represents a TripModifications.
         * @constructor
         * @param {transit_realtime.TripModifications.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const TripModifications = function (properties) {
            this.selectedTrips = [];
            this.startTimes = [];
            this.serviceDates = [];
            this.modifications = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * TripModifications selectedTrips.
         * @member {Array.<transit_realtime.TripModifications.SelectedTrips.$Properties>} selectedTrips
         * @memberof transit_realtime.TripModifications
         * @instance
         */
        TripModifications.prototype.selectedTrips = $util.emptyArray;

        /**
         * TripModifications startTimes.
         * @member {Array.<string>} startTimes
         * @memberof transit_realtime.TripModifications
         * @instance
         */
        TripModifications.prototype.startTimes = $util.emptyArray;

        /**
         * TripModifications serviceDates.
         * @member {Array.<string>} serviceDates
         * @memberof transit_realtime.TripModifications
         * @instance
         */
        TripModifications.prototype.serviceDates = $util.emptyArray;

        /**
         * TripModifications modifications.
         * @member {Array.<transit_realtime.TripModifications.Modification.$Properties>} modifications
         * @memberof transit_realtime.TripModifications
         * @instance
         */
        TripModifications.prototype.modifications = $util.emptyArray;

        /**
         * Encodes the specified TripModifications message. Does not implicitly {@link transit_realtime.TripModifications.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.TripModifications
         * @static
         * @param {transit_realtime.TripModifications.$Properties} message TripModifications message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        TripModifications.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.selectedTrips != null && message.selectedTrips.length)
                for (let i = 0; i < message.selectedTrips.length; ++i)
                    $root.transit_realtime.TripModifications.SelectedTrips.encode(message.selectedTrips[i], writer.uint32(/* id 1, wireType 2 =*/10).fork(), _depth + 1).ldelim();
            if (message.startTimes != null && message.startTimes.length)
                for (let i = 0; i < message.startTimes.length; ++i)
                    writer.uint32(/* id 2, wireType 2 =*/18).string(message.startTimes[i]);
            if (message.serviceDates != null && message.serviceDates.length)
                for (let i = 0; i < message.serviceDates.length; ++i)
                    writer.uint32(/* id 3, wireType 2 =*/26).string(message.serviceDates[i]);
            if (message.modifications != null && message.modifications.length)
                for (let i = 0; i < message.modifications.length; ++i)
                    $root.transit_realtime.TripModifications.Modification.encode(message.modifications[i], writer.uint32(/* id 4, wireType 2 =*/34).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a TripModifications message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.TripModifications
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.TripModifications & transit_realtime.TripModifications.$Shape} TripModifications
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        TripModifications.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TripModifications();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if (!(message.selectedTrips && message.selectedTrips.length))
                            message.selectedTrips = [];
                        message.selectedTrips.push($root.transit_realtime.TripModifications.SelectedTrips.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if (!(message.startTimes && message.startTimes.length))
                            message.startTimes = [];
                        message.startTimes.push(reader.string());
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        if (!(message.serviceDates && message.serviceDates.length))
                            message.serviceDates = [];
                        message.serviceDates.push(reader.string());
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        if (!(message.modifications && message.modifications.length))
                            message.modifications = [];
                        message.modifications.push($root.transit_realtime.TripModifications.Modification.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for TripModifications
         * @function getTypeUrl
         * @memberof transit_realtime.TripModifications
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        TripModifications.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.TripModifications";
        };

        TripModifications.Modification = (function() {

            /**
             * Properties of a Modification.
             * @typedef {Object} transit_realtime.TripModifications.Modification.$Properties
             * @property {transit_realtime.StopSelector.$Properties|null} [startStopSelector] Modification startStopSelector
             * @property {transit_realtime.StopSelector.$Properties|null} [endStopSelector] Modification endStopSelector
             * @property {number|null} [propagatedModificationDelay] Modification propagatedModificationDelay
             * @property {Array.<transit_realtime.ReplacementStop.$Properties>|null} [replacementStops] Modification replacementStops
             * @property {string|null} [serviceAlertId] Modification serviceAlertId
             * @property {number|Long|null} [lastModifiedTime] Modification lastModifiedTime
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */

            /**
             * Properties of a Modification.
             * @memberof transit_realtime.TripModifications
             * @interface IModification
             * @augments transit_realtime.TripModifications.Modification.$Properties
             * @deprecated Use transit_realtime.TripModifications.Modification.$Properties instead.
             */

            /**
             * Shape of a Modification.
             * @typedef {transit_realtime.TripModifications.Modification.$Properties} transit_realtime.TripModifications.Modification.$Shape
             */

            /**
             * Constructs a new Modification.
             * @memberof transit_realtime.TripModifications
             * @classdesc Represents a Modification.
             * @constructor
             * @param {transit_realtime.TripModifications.Modification.$Properties=} [properties] Properties to set
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */
            const Modification = function (properties) {
                this.replacementStops = [];
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            /**
             * Modification startStopSelector.
             * @member {transit_realtime.StopSelector.$Properties|null|undefined} startStopSelector
             * @memberof transit_realtime.TripModifications.Modification
             * @instance
             */
            Modification.prototype.startStopSelector = null;

            /**
             * Modification endStopSelector.
             * @member {transit_realtime.StopSelector.$Properties|null|undefined} endStopSelector
             * @memberof transit_realtime.TripModifications.Modification
             * @instance
             */
            Modification.prototype.endStopSelector = null;

            /**
             * Modification propagatedModificationDelay.
             * @member {number} propagatedModificationDelay
             * @memberof transit_realtime.TripModifications.Modification
             * @instance
             */
            Modification.prototype.propagatedModificationDelay = 0;

            /**
             * Modification replacementStops.
             * @member {Array.<transit_realtime.ReplacementStop.$Properties>} replacementStops
             * @memberof transit_realtime.TripModifications.Modification
             * @instance
             */
            Modification.prototype.replacementStops = $util.emptyArray;

            /**
             * Modification serviceAlertId.
             * @member {string} serviceAlertId
             * @memberof transit_realtime.TripModifications.Modification
             * @instance
             */
            Modification.prototype.serviceAlertId = "";

            /**
             * Modification lastModifiedTime.
             * @member {number|Long} lastModifiedTime
             * @memberof transit_realtime.TripModifications.Modification
             * @instance
             */
            Modification.prototype.lastModifiedTime = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

            /**
             * Encodes the specified Modification message. Does not implicitly {@link transit_realtime.TripModifications.Modification.verify|verify} messages.
             * @function encode
             * @memberof transit_realtime.TripModifications.Modification
             * @static
             * @param {transit_realtime.TripModifications.Modification.$Properties} message Modification message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            Modification.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (message.startStopSelector != null && $Object.hasOwnProperty.call(message, "startStopSelector"))
                    $root.transit_realtime.StopSelector.encode(message.startStopSelector, writer.uint32(/* id 1, wireType 2 =*/10).fork(), _depth + 1).ldelim();
                if (message.endStopSelector != null && $Object.hasOwnProperty.call(message, "endStopSelector"))
                    $root.transit_realtime.StopSelector.encode(message.endStopSelector, writer.uint32(/* id 2, wireType 2 =*/18).fork(), _depth + 1).ldelim();
                if (message.propagatedModificationDelay != null && $Object.hasOwnProperty.call(message, "propagatedModificationDelay"))
                    writer.uint32(/* id 3, wireType 0 =*/24).int32(message.propagatedModificationDelay);
                if (message.replacementStops != null && message.replacementStops.length)
                    for (let i = 0; i < message.replacementStops.length; ++i)
                        $root.transit_realtime.ReplacementStop.encode(message.replacementStops[i], writer.uint32(/* id 4, wireType 2 =*/34).fork(), _depth + 1).ldelim();
                if (message.serviceAlertId != null && $Object.hasOwnProperty.call(message, "serviceAlertId"))
                    writer.uint32(/* id 5, wireType 2 =*/42).string(message.serviceAlertId);
                if (message.lastModifiedTime != null && $Object.hasOwnProperty.call(message, "lastModifiedTime"))
                    writer.uint32(/* id 6, wireType 0 =*/48).uint64(message.lastModifiedTime);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            /**
             * Decodes a Modification message from the specified reader or buffer.
             * @function decode
             * @memberof transit_realtime.TripModifications.Modification
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {transit_realtime.TripModifications.Modification & transit_realtime.TripModifications.Modification.$Shape} Modification
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            Modification.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TripModifications.Modification();
                while (reader.pos < end) {
                    let start = reader.pos;
                    let tag = reader.tag();
                    if (tag === _end) {
                        _end = $undefined;
                        break;
                    }
                    let wireType = tag & 7;
                    switch (tag >>>= 3) {
                    case 1: {
                            if (wireType !== 2)
                                break;
                            message.startStopSelector = $root.transit_realtime.StopSelector.decode(reader, reader.uint32(), $undefined, _depth + 1, message.startStopSelector);
                            continue;
                        }
                    case 2: {
                            if (wireType !== 2)
                                break;
                            message.endStopSelector = $root.transit_realtime.StopSelector.decode(reader, reader.uint32(), $undefined, _depth + 1, message.endStopSelector);
                            continue;
                        }
                    case 3: {
                            if (wireType !== 0)
                                break;
                            message.propagatedModificationDelay = reader.int32();
                            continue;
                        }
                    case 4: {
                            if (wireType !== 2)
                                break;
                            if (!(message.replacementStops && message.replacementStops.length))
                                message.replacementStops = [];
                            message.replacementStops.push($root.transit_realtime.ReplacementStop.decode(reader, reader.uint32(), $undefined, _depth + 1));
                            continue;
                        }
                    case 5: {
                            if (wireType !== 2)
                                break;
                            message.serviceAlertId = reader.string();
                            continue;
                        }
                    case 6: {
                            if (wireType !== 0)
                                break;
                            message.lastModifiedTime = reader.uint64();
                            continue;
                        }
                    }
                    reader.skipType(wireType, _depth, tag);
                    if (!reader.discardUnknown) {
                        $util.makeProp(message, "$unknowns", false);
                        (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                    }
                }
                if (_end !== $undefined)
                    throw $Error("missing end group");
                return message;
            };

            /**
             * Gets the type url for Modification
             * @function getTypeUrl
             * @memberof transit_realtime.TripModifications.Modification
             * @static
             * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns {string} The type url
             */
            Modification.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/transit_realtime.TripModifications.Modification";
            };

            return Modification;
        })();

        TripModifications.SelectedTrips = (function() {

            /**
             * Properties of a SelectedTrips.
             * @typedef {Object} transit_realtime.TripModifications.SelectedTrips.$Properties
             * @property {Array.<string>|null} [tripIds] SelectedTrips tripIds
             * @property {string|null} [shapeId] SelectedTrips shapeId
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */

            /**
             * Properties of a SelectedTrips.
             * @memberof transit_realtime.TripModifications
             * @interface ISelectedTrips
             * @augments transit_realtime.TripModifications.SelectedTrips.$Properties
             * @deprecated Use transit_realtime.TripModifications.SelectedTrips.$Properties instead.
             */

            /**
             * Shape of a SelectedTrips.
             * @typedef {transit_realtime.TripModifications.SelectedTrips.$Properties} transit_realtime.TripModifications.SelectedTrips.$Shape
             */

            /**
             * Constructs a new SelectedTrips.
             * @memberof transit_realtime.TripModifications
             * @classdesc Represents a SelectedTrips.
             * @constructor
             * @param {transit_realtime.TripModifications.SelectedTrips.$Properties=} [properties] Properties to set
             * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
             */
            const SelectedTrips = function (properties) {
                this.tripIds = [];
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            /**
             * SelectedTrips tripIds.
             * @member {Array.<string>} tripIds
             * @memberof transit_realtime.TripModifications.SelectedTrips
             * @instance
             */
            SelectedTrips.prototype.tripIds = $util.emptyArray;

            /**
             * SelectedTrips shapeId.
             * @member {string} shapeId
             * @memberof transit_realtime.TripModifications.SelectedTrips
             * @instance
             */
            SelectedTrips.prototype.shapeId = "";

            /**
             * Encodes the specified SelectedTrips message. Does not implicitly {@link transit_realtime.TripModifications.SelectedTrips.verify|verify} messages.
             * @function encode
             * @memberof transit_realtime.TripModifications.SelectedTrips
             * @static
             * @param {transit_realtime.TripModifications.SelectedTrips.$Properties} message SelectedTrips message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            SelectedTrips.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (message.tripIds != null && message.tripIds.length)
                    for (let i = 0; i < message.tripIds.length; ++i)
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.tripIds[i]);
                if (message.shapeId != null && $Object.hasOwnProperty.call(message, "shapeId"))
                    writer.uint32(/* id 2, wireType 2 =*/18).string(message.shapeId);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            /**
             * Decodes a SelectedTrips message from the specified reader or buffer.
             * @function decode
             * @memberof transit_realtime.TripModifications.SelectedTrips
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {transit_realtime.TripModifications.SelectedTrips & transit_realtime.TripModifications.SelectedTrips.$Shape} SelectedTrips
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            SelectedTrips.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TripModifications.SelectedTrips();
                while (reader.pos < end) {
                    let start = reader.pos;
                    let tag = reader.tag();
                    if (tag === _end) {
                        _end = $undefined;
                        break;
                    }
                    let wireType = tag & 7;
                    switch (tag >>>= 3) {
                    case 1: {
                            if (wireType !== 2)
                                break;
                            if (!(message.tripIds && message.tripIds.length))
                                message.tripIds = [];
                            message.tripIds.push(reader.string());
                            continue;
                        }
                    case 2: {
                            if (wireType !== 2)
                                break;
                            message.shapeId = reader.string();
                            continue;
                        }
                    }
                    reader.skipType(wireType, _depth, tag);
                    if (!reader.discardUnknown) {
                        $util.makeProp(message, "$unknowns", false);
                        (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                    }
                }
                if (_end !== $undefined)
                    throw $Error("missing end group");
                return message;
            };

            /**
             * Gets the type url for SelectedTrips
             * @function getTypeUrl
             * @memberof transit_realtime.TripModifications.SelectedTrips
             * @static
             * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns {string} The type url
             */
            SelectedTrips.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/transit_realtime.TripModifications.SelectedTrips";
            };

            return SelectedTrips;
        })();

        return TripModifications;
    })();

    transit_realtime.StopSelector = (function() {

        /**
         * Properties of a StopSelector.
         * @typedef {Object} transit_realtime.StopSelector.$Properties
         * @property {number|null} [stopSequence] StopSelector stopSequence
         * @property {string|null} [stopId] StopSelector stopId
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a StopSelector.
         * @memberof transit_realtime
         * @interface IStopSelector
         * @augments transit_realtime.StopSelector.$Properties
         * @deprecated Use transit_realtime.StopSelector.$Properties instead.
         */

        /**
         * Shape of a StopSelector.
         * @typedef {transit_realtime.StopSelector.$Properties} transit_realtime.StopSelector.$Shape
         */

        /**
         * Constructs a new StopSelector.
         * @memberof transit_realtime
         * @classdesc Represents a StopSelector.
         * @constructor
         * @param {transit_realtime.StopSelector.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const StopSelector = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * StopSelector stopSequence.
         * @member {number} stopSequence
         * @memberof transit_realtime.StopSelector
         * @instance
         */
        StopSelector.prototype.stopSequence = 0;

        /**
         * StopSelector stopId.
         * @member {string} stopId
         * @memberof transit_realtime.StopSelector
         * @instance
         */
        StopSelector.prototype.stopId = "";

        /**
         * Encodes the specified StopSelector message. Does not implicitly {@link transit_realtime.StopSelector.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.StopSelector
         * @static
         * @param {transit_realtime.StopSelector.$Properties} message StopSelector message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        StopSelector.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.stopSequence != null && $Object.hasOwnProperty.call(message, "stopSequence"))
                writer.uint32(/* id 1, wireType 0 =*/8).uint32(message.stopSequence);
            if (message.stopId != null && $Object.hasOwnProperty.call(message, "stopId"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.stopId);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a StopSelector message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.StopSelector
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.StopSelector & transit_realtime.StopSelector.$Shape} StopSelector
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        StopSelector.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.StopSelector();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 0)
                            break;
                        message.stopSequence = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.stopId = reader.string();
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for StopSelector
         * @function getTypeUrl
         * @memberof transit_realtime.StopSelector
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        StopSelector.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.StopSelector";
        };

        return StopSelector;
    })();

    transit_realtime.ReplacementStop = (function() {

        /**
         * Properties of a ReplacementStop.
         * @typedef {Object} transit_realtime.ReplacementStop.$Properties
         * @property {number|null} [travelTimeToStop] ReplacementStop travelTimeToStop
         * @property {string|null} [stopId] ReplacementStop stopId
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a ReplacementStop.
         * @memberof transit_realtime
         * @interface IReplacementStop
         * @augments transit_realtime.ReplacementStop.$Properties
         * @deprecated Use transit_realtime.ReplacementStop.$Properties instead.
         */

        /**
         * Shape of a ReplacementStop.
         * @typedef {transit_realtime.ReplacementStop.$Properties} transit_realtime.ReplacementStop.$Shape
         */

        /**
         * Constructs a new ReplacementStop.
         * @memberof transit_realtime
         * @classdesc Represents a ReplacementStop.
         * @constructor
         * @param {transit_realtime.ReplacementStop.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const ReplacementStop = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * ReplacementStop travelTimeToStop.
         * @member {number} travelTimeToStop
         * @memberof transit_realtime.ReplacementStop
         * @instance
         */
        ReplacementStop.prototype.travelTimeToStop = 0;

        /**
         * ReplacementStop stopId.
         * @member {string} stopId
         * @memberof transit_realtime.ReplacementStop
         * @instance
         */
        ReplacementStop.prototype.stopId = "";

        /**
         * Encodes the specified ReplacementStop message. Does not implicitly {@link transit_realtime.ReplacementStop.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.ReplacementStop
         * @static
         * @param {transit_realtime.ReplacementStop.$Properties} message ReplacementStop message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ReplacementStop.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.travelTimeToStop != null && $Object.hasOwnProperty.call(message, "travelTimeToStop"))
                writer.uint32(/* id 1, wireType 0 =*/8).int32(message.travelTimeToStop);
            if (message.stopId != null && $Object.hasOwnProperty.call(message, "stopId"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.stopId);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a ReplacementStop message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.ReplacementStop
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.ReplacementStop & transit_realtime.ReplacementStop.$Shape} ReplacementStop
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ReplacementStop.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.ReplacementStop();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 0)
                            break;
                        message.travelTimeToStop = reader.int32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.stopId = reader.string();
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for ReplacementStop
         * @function getTypeUrl
         * @memberof transit_realtime.ReplacementStop
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        ReplacementStop.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.ReplacementStop";
        };

        return ReplacementStop;
    })();

    transit_realtime.TripReplacementPeriod = (function() {

        /**
         * Properties of a TripReplacementPeriod.
         * @typedef {Object} transit_realtime.TripReplacementPeriod.$Properties
         * @property {string|null} [routeId] TripReplacementPeriod routeId
         * @property {transit_realtime.TimeRange.$Properties|null} [replacementPeriod] TripReplacementPeriod replacementPeriod
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a TripReplacementPeriod.
         * @memberof transit_realtime
         * @interface ITripReplacementPeriod
         * @augments transit_realtime.TripReplacementPeriod.$Properties
         * @deprecated Use transit_realtime.TripReplacementPeriod.$Properties instead.
         */

        /**
         * Shape of a TripReplacementPeriod.
         * @typedef {transit_realtime.TripReplacementPeriod.$Properties} transit_realtime.TripReplacementPeriod.$Shape
         */

        /**
         * Constructs a new TripReplacementPeriod.
         * @memberof transit_realtime
         * @classdesc Represents a TripReplacementPeriod.
         * @constructor
         * @param {transit_realtime.TripReplacementPeriod.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const TripReplacementPeriod = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * TripReplacementPeriod routeId.
         * @member {string} routeId
         * @memberof transit_realtime.TripReplacementPeriod
         * @instance
         */
        TripReplacementPeriod.prototype.routeId = "";

        /**
         * TripReplacementPeriod replacementPeriod.
         * @member {transit_realtime.TimeRange.$Properties|null|undefined} replacementPeriod
         * @memberof transit_realtime.TripReplacementPeriod
         * @instance
         */
        TripReplacementPeriod.prototype.replacementPeriod = null;

        /**
         * Encodes the specified TripReplacementPeriod message. Does not implicitly {@link transit_realtime.TripReplacementPeriod.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.TripReplacementPeriod
         * @static
         * @param {transit_realtime.TripReplacementPeriod.$Properties} message TripReplacementPeriod message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        TripReplacementPeriod.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.routeId != null && $Object.hasOwnProperty.call(message, "routeId"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.routeId);
            if (message.replacementPeriod != null && $Object.hasOwnProperty.call(message, "replacementPeriod"))
                $root.transit_realtime.TimeRange.encode(message.replacementPeriod, writer.uint32(/* id 2, wireType 2 =*/18).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a TripReplacementPeriod message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.TripReplacementPeriod
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.TripReplacementPeriod & transit_realtime.TripReplacementPeriod.$Shape} TripReplacementPeriod
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        TripReplacementPeriod.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.TripReplacementPeriod();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        message.routeId = reader.string();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.replacementPeriod = $root.transit_realtime.TimeRange.decode(reader, reader.uint32(), $undefined, _depth + 1, message.replacementPeriod);
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for TripReplacementPeriod
         * @function getTypeUrl
         * @memberof transit_realtime.TripReplacementPeriod
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        TripReplacementPeriod.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.TripReplacementPeriod";
        };

        return TripReplacementPeriod;
    })();

    transit_realtime.NyctFeedHeader = (function() {

        /**
         * Properties of a NyctFeedHeader.
         * @typedef {Object} transit_realtime.NyctFeedHeader.$Properties
         * @property {string} nyctSubwayVersion NyctFeedHeader nyctSubwayVersion
         * @property {Array.<transit_realtime.TripReplacementPeriod.$Properties>|null} [tripReplacementPeriod] NyctFeedHeader tripReplacementPeriod
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a NyctFeedHeader.
         * @memberof transit_realtime
         * @interface INyctFeedHeader
         * @augments transit_realtime.NyctFeedHeader.$Properties
         * @deprecated Use transit_realtime.NyctFeedHeader.$Properties instead.
         */

        /**
         * Shape of a NyctFeedHeader.
         * @typedef {transit_realtime.NyctFeedHeader.$Properties} transit_realtime.NyctFeedHeader.$Shape
         */

        /**
         * Constructs a new NyctFeedHeader.
         * @memberof transit_realtime
         * @classdesc Represents a NyctFeedHeader.
         * @constructor
         * @param {transit_realtime.NyctFeedHeader.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const NyctFeedHeader = function (properties) {
            this.tripReplacementPeriod = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * NyctFeedHeader nyctSubwayVersion.
         * @member {string} nyctSubwayVersion
         * @memberof transit_realtime.NyctFeedHeader
         * @instance
         */
        NyctFeedHeader.prototype.nyctSubwayVersion = "";

        /**
         * NyctFeedHeader tripReplacementPeriod.
         * @member {Array.<transit_realtime.TripReplacementPeriod.$Properties>} tripReplacementPeriod
         * @memberof transit_realtime.NyctFeedHeader
         * @instance
         */
        NyctFeedHeader.prototype.tripReplacementPeriod = $util.emptyArray;

        /**
         * Encodes the specified NyctFeedHeader message. Does not implicitly {@link transit_realtime.NyctFeedHeader.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.NyctFeedHeader
         * @static
         * @param {transit_realtime.NyctFeedHeader.$Properties} message NyctFeedHeader message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        NyctFeedHeader.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            writer.uint32(/* id 1, wireType 2 =*/10).string(message.nyctSubwayVersion);
            if (message.tripReplacementPeriod != null && message.tripReplacementPeriod.length)
                for (let i = 0; i < message.tripReplacementPeriod.length; ++i)
                    $root.transit_realtime.TripReplacementPeriod.encode(message.tripReplacementPeriod[i], writer.uint32(/* id 2, wireType 2 =*/18).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a NyctFeedHeader message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.NyctFeedHeader
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.NyctFeedHeader & transit_realtime.NyctFeedHeader.$Shape} NyctFeedHeader
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        NyctFeedHeader.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.NyctFeedHeader();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        message.nyctSubwayVersion = reader.string();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if (!(message.tripReplacementPeriod && message.tripReplacementPeriod.length))
                            message.tripReplacementPeriod = [];
                        message.tripReplacementPeriod.push($root.transit_realtime.TripReplacementPeriod.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            if (!$Object.hasOwnProperty.call(message, "nyctSubwayVersion"))
                throw $util.ProtocolError("missing required 'nyctSubwayVersion'", { instance: message });
            return message;
        };

        /**
         * Gets the type url for NyctFeedHeader
         * @function getTypeUrl
         * @memberof transit_realtime.NyctFeedHeader
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        NyctFeedHeader.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.NyctFeedHeader";
        };

        return NyctFeedHeader;
    })();

    transit_realtime.NyctTripDescriptor = (function() {

        /**
         * Properties of a NyctTripDescriptor.
         * @typedef {Object} transit_realtime.NyctTripDescriptor.$Properties
         * @property {string|null} [trainId] NyctTripDescriptor trainId
         * @property {boolean|null} [isAssigned] NyctTripDescriptor isAssigned
         * @property {transit_realtime.NyctTripDescriptor.Direction|null} [direction] NyctTripDescriptor direction
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a NyctTripDescriptor.
         * @memberof transit_realtime
         * @interface INyctTripDescriptor
         * @augments transit_realtime.NyctTripDescriptor.$Properties
         * @deprecated Use transit_realtime.NyctTripDescriptor.$Properties instead.
         */

        /**
         * Shape of a NyctTripDescriptor.
         * @typedef {transit_realtime.NyctTripDescriptor.$Properties} transit_realtime.NyctTripDescriptor.$Shape
         */

        /**
         * Constructs a new NyctTripDescriptor.
         * @memberof transit_realtime
         * @classdesc Represents a NyctTripDescriptor.
         * @constructor
         * @param {transit_realtime.NyctTripDescriptor.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const NyctTripDescriptor = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * NyctTripDescriptor trainId.
         * @member {string} trainId
         * @memberof transit_realtime.NyctTripDescriptor
         * @instance
         */
        NyctTripDescriptor.prototype.trainId = "";

        /**
         * NyctTripDescriptor isAssigned.
         * @member {boolean} isAssigned
         * @memberof transit_realtime.NyctTripDescriptor
         * @instance
         */
        NyctTripDescriptor.prototype.isAssigned = false;

        /**
         * NyctTripDescriptor direction.
         * @member {transit_realtime.NyctTripDescriptor.Direction} direction
         * @memberof transit_realtime.NyctTripDescriptor
         * @instance
         */
        NyctTripDescriptor.prototype.direction = 1;

        /**
         * Encodes the specified NyctTripDescriptor message. Does not implicitly {@link transit_realtime.NyctTripDescriptor.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.NyctTripDescriptor
         * @static
         * @param {transit_realtime.NyctTripDescriptor.$Properties} message NyctTripDescriptor message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        NyctTripDescriptor.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.trainId != null && $Object.hasOwnProperty.call(message, "trainId"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.trainId);
            if (message.isAssigned != null && $Object.hasOwnProperty.call(message, "isAssigned"))
                writer.uint32(/* id 2, wireType 0 =*/16).bool(message.isAssigned);
            if (message.direction != null && $Object.hasOwnProperty.call(message, "direction"))
                writer.uint32(/* id 3, wireType 0 =*/24).int32(message.direction);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a NyctTripDescriptor message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.NyctTripDescriptor
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.NyctTripDescriptor & transit_realtime.NyctTripDescriptor.$Shape} NyctTripDescriptor
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        NyctTripDescriptor.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.NyctTripDescriptor(), value;
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        message.trainId = reader.string();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.isAssigned = reader.bool();
                        continue;
                    }
                case 3: {
                        if (wireType !== 0)
                            break;
                        value = reader.int32();
                        if ($root.transit_realtime.NyctTripDescriptor.Direction[value] !== $undefined)
                            message.direction = value;
                        else if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for NyctTripDescriptor
         * @function getTypeUrl
         * @memberof transit_realtime.NyctTripDescriptor
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        NyctTripDescriptor.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.NyctTripDescriptor";
        };

        /**
         * Direction enum.
         * @name transit_realtime.NyctTripDescriptor.Direction
         * @enum {number}
         * @property {number} NORTH=1 NORTH value
         * @property {number} EAST=2 EAST value
         * @property {number} SOUTH=3 SOUTH value
         * @property {number} WEST=4 WEST value
         */
        NyctTripDescriptor.Direction = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[1] = "NORTH"] = 1;
            values[valuesById[2] = "EAST"] = 2;
            values[valuesById[3] = "SOUTH"] = 3;
            values[valuesById[4] = "WEST"] = 4;
            return values;
        })();

        return NyctTripDescriptor;
    })();

    transit_realtime.NyctStopTimeUpdate = (function() {

        /**
         * Properties of a NyctStopTimeUpdate.
         * @typedef {Object} transit_realtime.NyctStopTimeUpdate.$Properties
         * @property {string|null} [scheduledTrack] NyctStopTimeUpdate scheduledTrack
         * @property {string|null} [actualTrack] NyctStopTimeUpdate actualTrack
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */

        /**
         * Properties of a NyctStopTimeUpdate.
         * @memberof transit_realtime
         * @interface INyctStopTimeUpdate
         * @augments transit_realtime.NyctStopTimeUpdate.$Properties
         * @deprecated Use transit_realtime.NyctStopTimeUpdate.$Properties instead.
         */

        /**
         * Shape of a NyctStopTimeUpdate.
         * @typedef {transit_realtime.NyctStopTimeUpdate.$Properties} transit_realtime.NyctStopTimeUpdate.$Shape
         */

        /**
         * Constructs a new NyctStopTimeUpdate.
         * @memberof transit_realtime
         * @classdesc Represents a NyctStopTimeUpdate.
         * @constructor
         * @param {transit_realtime.NyctStopTimeUpdate.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
         */
        const NyctStopTimeUpdate = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        /**
         * NyctStopTimeUpdate scheduledTrack.
         * @member {string} scheduledTrack
         * @memberof transit_realtime.NyctStopTimeUpdate
         * @instance
         */
        NyctStopTimeUpdate.prototype.scheduledTrack = "";

        /**
         * NyctStopTimeUpdate actualTrack.
         * @member {string} actualTrack
         * @memberof transit_realtime.NyctStopTimeUpdate
         * @instance
         */
        NyctStopTimeUpdate.prototype.actualTrack = "";

        /**
         * Encodes the specified NyctStopTimeUpdate message. Does not implicitly {@link transit_realtime.NyctStopTimeUpdate.verify|verify} messages.
         * @function encode
         * @memberof transit_realtime.NyctStopTimeUpdate
         * @static
         * @param {transit_realtime.NyctStopTimeUpdate.$Properties} message NyctStopTimeUpdate message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        NyctStopTimeUpdate.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.scheduledTrack != null && $Object.hasOwnProperty.call(message, "scheduledTrack"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.scheduledTrack);
            if (message.actualTrack != null && $Object.hasOwnProperty.call(message, "actualTrack"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.actualTrack);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Decodes a NyctStopTimeUpdate message from the specified reader or buffer.
         * @function decode
         * @memberof transit_realtime.NyctStopTimeUpdate
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {transit_realtime.NyctStopTimeUpdate & transit_realtime.NyctStopTimeUpdate.$Shape} NyctStopTimeUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        NyctStopTimeUpdate.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end = length === $undefined ? reader.len : reader.pos + length, message = _target || new $root.transit_realtime.NyctStopTimeUpdate();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        message.scheduledTrack = reader.string();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.actualTrack = reader.string();
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        /**
         * Gets the type url for NyctStopTimeUpdate
         * @function getTypeUrl
         * @memberof transit_realtime.NyctStopTimeUpdate
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        NyctStopTimeUpdate.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/transit_realtime.NyctStopTimeUpdate";
        };

        return NyctStopTimeUpdate;
    })();

    return transit_realtime;
})();

export {
  $root as default
};
