import { MovieShowcase } from 'fantasy-reel'
import { movie, POSTERS, daysOut } from './_fixtures'

const upcoming = [
  movie({ release_date: daysOut(20) }),
  movie({
    tmdb_id: 653346,
    title: 'Kingdom of the Planet of the Apes',
    poster_url: POSTERS.apes,
    release_date: daysOut(35),
    vote_average: 7.1,
  }),
  movie({
    tmdb_id: 823464,
    title: 'Godzilla x Kong: The New Empire',
    poster_url: POSTERS.godzilla,
    release_date: daysOut(50),
    vote_average: 7.2,
  }),
  movie({
    tmdb_id: 762441,
    title: 'A Quiet Place: Day One',
    poster_url: POSTERS.quietPlace,
    release_date: daysOut(64),
    vote_average: 6.9,
  }),
  movie({
    tmdb_id: 573435,
    title: 'Bad Boys: Ride or Die',
    poster_url: POSTERS.badBoys,
    release_date: daysOut(78),
    vote_average: 7.0,
  }),
]

/** The "Now Drafting" band — upcoming releases with their dates. */
export const Default = () => <MovieShowcase movies={upcoming} />

/** A movie with no confirmed date reads TBA. */
export const WithUndatedTitle = () => (
  <MovieShowcase
    movies={[
      ...upcoming.slice(0, 3),
      movie({
        tmdb_id: 1125899,
        title: 'Untitled Villeneuve Project',
        poster_url: null,
        release_date: null,
        vote_average: 0,
      }),
    ]}
  />
)
