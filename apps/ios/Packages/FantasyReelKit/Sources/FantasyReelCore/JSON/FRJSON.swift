import Foundation

/// The one JSON configuration for everything the app reads from or sends to the
/// backend.
///
/// There is deliberately no key strategy: every model spells its snake_case
/// keys in `CodingKeys`, because `.convertFromSnakeCase` would also rewrite the
/// keys of free-form dictionaries such as `notifications.data`.
///
/// `decoder`/`encoder` are computed and return a fresh instance each time; a
/// coder is cheap to make, and this keeps the type free of shared mutable state.
public enum FRJSON {
    public static var decoder: JSONDecoder { makeDecoder() }
    public static var encoder: JSONEncoder { makeEncoder() }

    public static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            guard let date = PostgresTimestamp.parse(string) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Unrecognized timestamp: \(string)"
                )
            }
            return date
        }
        return decoder
    }

    public static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(PostgresTimestamp.format(date))
        }
        return encoder
    }

    public static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try makeDecoder().decode(type, from: data)
    }

    public static func encode<T: Encodable>(_ value: T) throws -> Data {
        try makeEncoder().encode(value)
    }
}

// MARK: - Lenient numeric decoding

extension KeyedDecodingContainer {
    /// A Postgres `numeric`/`decimal` value. PostgREST sends these as JSON
    /// numbers, but some RPCs and older paths serialize them as strings
    /// ("16.25"); accept both so a column type change can't break decoding.
    func decodeNumeric(forKey key: Key) throws -> Double? {
        guard contains(key), try !decodeNil(forKey: key) else { return nil }
        if let value = try? decode(Double.self, forKey: key) { return value }
        let string = try decode(String.self, forKey: key)
        guard let value = Double(string.trimmingCharacters(in: .whitespaces)) else {
            throw DecodingError.dataCorruptedError(
                forKey: key, in: self, debugDescription: "Expected a number, got \(string)"
            )
        }
        return value
    }

    /// Required numeric value (see `decodeNumeric`).
    func decodeRequiredNumeric(forKey key: Key) throws -> Double {
        guard let value = try decodeNumeric(forKey: key) else {
            throw DecodingError.valueNotFound(
                Double.self,
                .init(codingPath: codingPath + [key], debugDescription: "Expected a number.")
            )
        }
        return value
    }

    /// An integer column, accepting a whole JSON number written as `5.0` too.
    func decodeInteger(forKey key: Key) throws -> Int? {
        guard let value = try decodeNumeric(forKey: key) else { return nil }
        guard let int = Int(exactly: value) else {
            throw DecodingError.dataCorruptedError(
                forKey: key, in: self, debugDescription: "Expected a whole number, got \(value)"
            )
        }
        return int
    }

    /// A field a partial `select` may omit: decoded when present and non-null,
    /// otherwise the schema default.
    func decode<T: Decodable>(_ type: T.Type, forKey key: Key, default defaultValue: T) throws -> T {
        try decodeIfPresent(type, forKey: key) ?? defaultValue
    }
}
